import { KeyManagementServiceClient } from '@google-cloud/kms';
import { ethers } from 'ethers';
import { ConfigService } from '@core/config/configService';
import { getLogger, PinoLogger } from '@core/logger/loggerService';
import { ec as EC } from 'elliptic';

const logger: PinoLogger = getLogger('KmsService');
const secp256k1 = new EC('secp256k1');

interface KmsInternalSignature {
  r: string;
  s: string;
  yParity: 0 | 1;
}

function pemToEthereumAddress(pemPublicKey: string): string | null {
  try {
    const base64Key = pemPublicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\n/g, '');

    const publicKeyDer = Buffer.from(base64Key, 'base64');

    if (publicKeyDer.length < 65) {
      logger.error('Public key DER length too short for secp256k1.');
      return null;
    }
    const potentialRawKey = publicKeyDer.subarray(publicKeyDer.length - 65);
    if (potentialRawKey[0] === 0x04) {
      const address = ethers.computeAddress(`0x${potentialRawKey.toString('hex')}`);
      logger.info(`Derived address ${address} from uncompressed key.`);
      return address;
    } else {
      logger.warn('Public key does not start with 0x04.');
      try {
        const address = ethers.computeAddress(`0x${potentialRawKey.toString('hex')}`);
        logger.info(`Derived address ${address} from assumed key.`);
        return address;
      } catch (e: any) {
        logger.error({ err: e.message }, 'Failed to compute address.');
      }
    }

    logger.error('Could not extract public key from PEM.');
    return null;
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error converting PEM to address.');
    return null;
  }
}

export class KmsService {
  private kmsClient: KeyManagementServiceClient;
  private keyPath: string;
  private ethereumAddressCache: string | null = null;

  constructor(private configService: ConfigService) {
    const kmsKeyPath = this.configService.getOrThrow('kms_config.operational_wallet_key_path') as string;
    this.keyPath = kmsKeyPath;
    this.kmsClient = new KeyManagementServiceClient();
    logger.info(`Initialized with key path ${this.keyPath}`);
  }

  public async getBotAddress(): Promise<string> {
    const address = await this.getEthereumAddress();
    if (!address) {
      throw new Error(`Failed to derive Ethereum address for key ${this.keyPath}`);
    }
    return address;
  }

  private async getEthereumAddress(forceRefresh: boolean = false): Promise<string | null> {
    if (this.ethereumAddressCache && !forceRefresh) {
      return this.ethereumAddressCache;
    }
    logger.info(`Retrieving public key for ${this.keyPath}`);
    try {
      const [publicKeyProto] = await this.kmsClient.getPublicKey({ name: this.keyPath });
      if (!publicKeyProto?.pem) {
        logger.error(`Could not retrieve PEM public key from ${this.keyPath}`);
        return null;
      }

      const address = pemToEthereumAddress(publicKeyProto.pem);
      if (address) {
        this.ethereumAddressCache = address;
        logger.info(`Derived Ethereum address ${address}`);
        return address;
      }
      return null;
    } catch (error: any) {
      logger.error({ err: error.message }, 'Error retrieving public key.');
      return null;
    }
  }

  private async signTransactionDigest(digestHex: string): Promise<KmsInternalSignature | null> {
    const digestBuffer = Buffer.from(digestHex.slice(2), 'hex');
    logger.debug(`Signing digest ${digestHex}`);

    try {
      const [signResponse] = await this.kmsClient.asymmetricSign({
        name: this.keyPath,
        digest: { sha256: digestBuffer },
      });

      if (!signResponse?.signature) {
        logger.error('KMS signing failed, no signature returned.');
        return null;
      }

      const signatureDer = Buffer.from(signResponse.signature);
      const parsedSignature = secp256k1.signatureImport(signatureDer);
      const r = ethers.toBeHex(parsedSignature.r.toString('hex'));
      const s = ethers.toBeHex(parsedSignature.s.toString('hex'));

      const ethAddress = await this.getEthereumAddress();
      if (!ethAddress) {
        logger.error('Cannot determine yParity without Ethereum address.');
        return null;
      }

      let yParity: 0 | 1 | undefined;
      for (const v of [0, 1] as (0 | 1)[]) {
        const recoveredAddress = ethers.recoverAddress(digestHex, { r, s, yParity: v });
        if (recoveredAddress.toLowerCase() === ethAddress.toLowerCase()) {
          yParity = v;
          break;
        }
      }

      if (yParity === undefined) {
        logger.error('Could not determine yParity.');
        return null;
      }

      const ethersSignature: KmsInternalSignature = { r, s, yParity };
      logger.info(`Signed digest. R: ${r}, S: ${s}, yParity: ${yParity}`);
      return ethersSignature;
    } catch (error: any) {
      logger.error({ err: error.message }, 'Error signing digest.');
      return null;
    }
  }

  public async signTransaction(transactionRequest: ethers.TransactionRequest): Promise<string> {
    logger.debug({ txData: transactionRequest }, 'Signing Ethereum transaction.');

    if (!transactionRequest.from) {
      const derivedAddress = await this.getEthereumAddress();
      if (derivedAddress) {
        transactionRequest.from = derivedAddress;
        logger.info(`Set 'from' address to ${derivedAddress}`);
      } else {
        throw new Error('Cannot sign without "from" address.');
      }
    }

    let numericNonce: number;
    if (transactionRequest.nonce !== undefined) {
      try {
        numericNonce = Number(ethers.toBigInt(transactionRequest.nonce));
      } catch (e: any) {
        logger.error({ err: e.message }, 'Invalid nonce value.');
        throw new Error('Invalid nonce value');
      }
    } else {
      throw new Error('Transaction nonce is required.');
    }

    const transactionFields: ethers.TransactionRequest = {
      to: transactionRequest.to,
      nonce: numericNonce,
      gasLimit: transactionRequest.gasLimit,
      gasPrice: transactionRequest.gasPrice,
      data: transactionRequest.data,
      value: transactionRequest.value,
      chainId: transactionRequest.chainId,
      type: transactionRequest.type,
      maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas,
      maxFeePerGas: transactionRequest.maxFeePerGas,
    };

    Object.keys(transactionFields).forEach(key => {
      if (transactionFields[key as keyof ethers.TransactionRequest] === undefined) {
        delete transactionFields[key as keyof ethers.TransactionRequest];
      }
    });

    const unsignedTx = ethers.serializeTransaction(transactionFields);
    const txDigest = ethers.keccak256(unsignedTx);

    const signature = await this.signTransactionDigest(txDigest);
    if (!signature) {
      throw new Error('Failed to obtain signature.');
    }

    const signedTx = ethers.serializeTransaction(transactionFields, signature);
    return signedTx;
  }
}