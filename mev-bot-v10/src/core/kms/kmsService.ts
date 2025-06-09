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
    recoveryParam: number;
}

function pemToEthereumAddress(pemPublicKey: string): string | null {
    try {
        const base64Key = pemPublicKey
            .replace('-----BEGIN PUBLIC KEY-----', '')
            .replace('-----END PUBLIC KEY-----', '')
            .replace(/\n/g, '');

        const publicKeyDer = Buffer.from(base64Key, 'base64');

        if (publicKeyDer.length < 65) {
            logger.error("KMS Service: Public key DER length too short to be uncompressed secp256k1 key.");
            return null;
        }
        const potentialRawKey = publicKeyDer.subarray(publicKeyDer.length - 65);
        if (potentialRawKey[0] === 0x04) {
            const address = ethers.computeAddress(potentialRawKey);
            logger.info(`KMS Service: Derived address ${address} from potential raw key in PEM.`);
            return address;
        } else {
            logger.warn("KMS Service: Potential raw public key from PEM does not start with 0x04 (uncompressed).");
            try {
                const address = ethers.computeAddress("0x" + potentialRawKey.toString('hex'));
                logger.info(`KMS Service: Derived address ${address} from PEM (assuming direct hex conversion).`);
                return address;
            } catch (e) {
                logger.error({ err: e.message }, "KMS Service: Failed to compute address from assumed raw key in PEM.");
            }
        }

        logger.error("KMS Service: Could not reliably extract uncompressed public key from PEM to derive Ethereum address.");
        return null;
    } catch (error) {
        logger.error({ err: error.message }, "KMS Service: Error converting PEM public key to Ethereum address.");
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
        logger.info(`KmsService: Initialized with key path ${this.keyPath}`);
    }

    public async getBotAddress(): Promise<string> {
        const address = await this.getEthereumAddress();
        if (!address) {
            throw new Error(`KMS Service: Failed to derive Ethereum address for key ${this.keyPath}`);
        }
        return address;
    }

    private async getEthereumAddress(forceRefresh: boolean = false): Promise<string | null> {
        if (this.ethereumAddressCache && !forceRefresh) {
            return this.ethereumAddressCache;
        }
        logger.info(`KmsService: Attempting to retrieve public key and derive address for ${this.keyPath}`);
        try {
            const [publicKeyProto] = await this.kmsClient.getPublicKey({ name: this.keyPath });
            if (!publicKeyProto?.pem) {
                logger.error(`KmsService: Could not retrieve PEM public key from KMS path: ${this.keyPath}`);
                return null;
            }

            const address = pemToEthereumAddress(publicKeyProto.pem);
            if (address) {
                this.ethereumAddressCache = address;
                logger.info(`KmsService: Derived Ethereum address ${address} for KMS key.`);
                return address;
            }
            return null;
        } catch (error) {
            logger.error({ err: error.message, keyPath: this.keyPath }, "KmsService: Error retrieving or converting public key from KMS.");
            return null;
        }
    }

    private async signTransactionDigest(digestHex: string): Promise<KmsInternalSignature | null> {
        const digestBuffer = Buffer.from(digestHex.slice(2), 'hex');
        logger.debug(`KmsService: Signing digest ${digestHex} for key ${this.keyPath}`);

        try {
            const [signResponse] = await this.kmsClient.asymmetricSign({
                name: this.keyPath,
                digest: { sha256: digestBuffer },
            });

            if (!signResponse?.signature) {
                logger.error('KmsService: KMS signing failed, no signature returned from API.');
                return null;
            }

            const signatureDer = Buffer.from(signResponse.signature);
            const parsedSignature = secp256k1.signatureImport(signatureDer);
            const r = ethers.toBeHex(parsedSignature.r);
            const s = ethers.toBeHex(parsedSignature.s);

            const ethAddress = await this.getEthereumAddress();
            if (!ethAddress) {
                logger.error("KmsService: Cannot determine recovery ID without the Ethereum address of the KMS key.");
                return null;
            }

            let recoveryParam: number | undefined;
            for (const v of [0, 1]) {
                const recoveredAddress = ethers.recoverAddress(digestHex, {
                    r,
                    s,
                    recoveryParam: v,
                });
                if (recoveredAddress.toLowerCase() === ethAddress.toLowerCase()) {
                    recoveryParam = v;
                    break;
                }
            }

            if (recoveryParam === undefined) {
                logger.error("KmsService: Could not determine recovery parameter for the signature.");
                return null;
            }

            const ethersSignature: KmsInternalSignature = {
                r,
                s,
                recoveryParam,
            };

            logger.info(`KmsService: Successfully signed digest. R: ${r}, S: ${s}, recoveryParam: ${recoveryParam}`);
            return ethersSignature;
        } catch (error) {
            logger.error({ err: error.message }, "KmsService: Error signing digest with KMS.");
            return null;
        }
    }

    public async signTransaction(transactionRequest: ethers.TransactionRequest): Promise<string> {
        logger.debug({ txData: transactionRequest }, "KmsService: Attempting to sign Ethereum transaction.");

        if (!transactionRequest.from) {
            const derivedAddress = await this.getEthereumAddress();
            if (derivedAddress) {
                transactionRequest.from = derivedAddress;
                logger.info(`KmsService: 'from' address automatically set to derived KMS address: ${derivedAddress}`);
            } else {
                throw new Error("KmsService: Cannot sign transaction without 'from' address and failed to derive one from KMS key.");
            }
        }

        let numericNonce: number;
        if (transactionRequest.nonce !== undefined) {
            try {
                numericNonce = Number(ethers.toBigInt(transactionRequest.nonce));
            } catch (e) {
                logger.error({ err: e.message, originalNonce: transactionRequest.nonce }, "KmsService: Invalid nonce value, cannot convert to number.");
                throw new Error("Invalid nonce value");
            }
        } else {
            throw new Error("KmsService: Transaction nonce is required for signing.");
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
            throw new Error("KmsService: Failed to obtain signature for the transaction digest.");
        }

        const signedTx = ethers.serializeTransaction(transactionFields, signature);
        return signedTx;
    }
}