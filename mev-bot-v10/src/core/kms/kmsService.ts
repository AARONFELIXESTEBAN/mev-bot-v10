import { KeyManagementServiceClient, protos } from '@google-cloud/kms';
import { ethers, utils as ethersUtils, providers, BigNumber } from 'ethers'; // Removed Signature and SignatureLike from root
import { SignatureLike } from 'ethers/lib/utils'; // Deep import for SignatureLike
import { ConfigService } from '../config/configService'; // Adjust path
import { getLogger } from '../logger/loggerService'; // Adjust path
// elliptic is a good library for EC operations, including signature parsing and public key recovery
import { ec as EC } from 'elliptic';

const logger = getLogger();
const secp256k1 = new EC('secp256k1');


// Helper to convert PEM public key to uncompressed hex, then to Ethereum address
function pemToEthereumAddress(pemPublicKey: string): string | null {
    try {
        const base64Key = pemPublicKey
            .replace('-----BEGIN PUBLIC KEY-----', '')
            .replace('-----END PUBLIC KEY-----', '')
            .replace(/\n/g, '');

        const publicKeyDer = Buffer.from(base64Key, 'base64');

        // A common way to get the raw public key from SPKI PEM/DER format
        // is to use crypto.createPublicKey and export it in a raw format if available,
        // or parse the ASN.1 structure.
        // The 'elliptic' library can parse uncompressed public keys.
        // We need to extract the raw public key bytes from the DER structure.
        // For secp256k1, an uncompressed public key is 65 bytes (0x04 + X + Y).
        // A common DER structure for SubjectPublicKeyInfo for ECC keys has the key at the end.
        // OID for secp256k1: 1.3.132.0.10
        // OID for ecPublicKey: 1.2.840.10045.2.1

        // This is a simplified extraction, assuming the last 65 bytes are the uncompressed key.
        // This may not be robust for all PEM formats from KMS.
        if (publicKeyDer.length < 65) {
            logger.error("KMS Service: Public key DER length too short to be uncompressed secp256k1 key.");
            return null;
        }
        const potentialRawKey = publicKeyDer.subarray(publicKeyDer.length - 65);
        if (potentialRawKey[0] === 0x04) { // Check for uncompressed key prefix
            const address = ethersUtils.computeAddress(potentialRawKey);
            logger.info(`KMS Service: Derived address ${address} from potential raw key in PEM.`);
            return address;
        } else {
            logger.warn("KMS Service: Potential raw public key from PEM does not start with 0x04 (uncompressed). Address derivation might fail or be incorrect.");
            // Try to compute address anyway, computeAddress might handle compressed if it's just X coord.
             try {
                const address = ethersUtils.computeAddress("0x" + potentialRawKey.toString('hex'));
                logger.info(`KMS Service: Derived address ${address} from PEM (assuming direct hex conversion).`);
                return address;
            } catch (e) {
                 logger.error({err: e}, "KMS Service: Failed to compute address from assumed raw key in PEM.");
            }
        }

        logger.error("KMS Service: Could not reliably extract uncompressed public key from PEM to derive Ethereum address.");
        logger.warn("KMS Service: Consider pre-configuring the Ethereum address or using a dedicated crypto library for robust SPKI PEM parsing.");
        return null;

    } catch (error) {
        logger.error({ err: error }, "KMS Service: Error converting PEM public key to Ethereum address.");
        return null;
    }
}


export class KmsService {
    private kmsClient: KeyManagementServiceClient;
    private keyPath: string;
    private ethereumAddressCache: string | null = null;

    constructor(private configService: ConfigService) {
        const kmsKeyPath = this.configService.getOrThrow('kms_config.operational_wallet_key_path');
        this.keyPath = kmsKeyPath;
        this.kmsClient = new KeyManagementServiceClient();
        logger.info(`KmsService: Initialized with key path ${this.keyPath}`);
    }

    public async getEthereumAddress(forceRefresh: boolean = false): Promise<string | null> {
        if (this.ethereumAddressCache && !forceRefresh) {
            return this.ethereumAddressCache;
        }
        logger.info(`KmsService: Attempting to retrieve public key and derive address for ${this.keyPath}`);
        try {
            const [publicKeyProto] = await this.kmsClient.getPublicKey({ name: this.keyPath });
            if (!publicKeyProto || !publicKeyProto.pem) {
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
            logger.error({ err: error, keyPath: this.keyPath }, "KmsService: Error retrieving or converting public key from KMS.");
            return null;
        }
    }

    public async signTransactionDigest(digestHex: string): Promise<SignatureLike | null> { // Updated return type
        const digestBuffer = Buffer.from(digestHex.slice(2), 'hex');
        logger.debug(`KmsService: Signing digest ${digestHex} for key ${this.keyPath}`);

        try {
            const [signResponse] = await this.kmsClient.asymmetricSign({
                name: this.keyPath,
                digest: { sha256: digestBuffer },
            });

            if (!signResponse || !signResponse.signature) {
                logger.error('KmsService: KMS signing failed, no signature returned from API.');
                return null;
            }

            const signatureDer = Buffer.from(signResponse.signature as Uint8Array);

            // Parse the DER-encoded signature to get R and S values
            // Assuming signatureDer is a Buffer
            const parsedSignature = (secp256k1 as any).signatureImport(signatureDer);
            const r = BigNumber.from("0x" + parsedSignature.r.toString('hex'));
            const s = BigNumber.from("0x" + parsedSignature.s.toString('hex'));

            // Determine recovery ID (v)
            // This requires the Ethereum address (public key) associated with the KMS key.
            const ethAddress = await this.getEthereumAddress();
            if (!ethAddress) {
                logger.error("KmsService: Cannot determine recovery ID without the Ethereum address of the KMS key.");
                return null;
            }

            let recoveryParam: number | undefined = undefined;
            for (const v_candidate of [0, 1]) {
                const recoveredAddress = ethersUtils.recoverAddress(digestHex, {
                    r: r.toHexString(),
                    s: s.toHexString(),
                    recoveryParam: v_candidate,
                    // Ethers v5 might also accept 'v' directly if it's 27/28
                });
                if (recoveredAddress.toLowerCase() === ethAddress.toLowerCase()) {
                    recoveryParam = v_candidate;
                    break;
                }
            }

            if (recoveryParam === undefined) {
                logger.error("KmsService: Could not determine recovery parameter 'v' for the signature.");
                return null;
            }

            // ethers.Signature object
            const ethersSignature: SignatureLike = { // Use directly imported SignatureLike
                r: r.toHexString(),
                s: s.toHexString(),
                recoveryParam: recoveryParam,
                // Ethers v5 often expects `v` to be the EIP-155 compliant value if chainId is involved,
                // or 27/28. `splitSignature` and `joinSignature` handle this.
                // For `utils.serializeTransaction`, providing `recoveryParam` along with `r` and `s`
                // in the signature object is often enough if the transaction object itself has a chainId.
                // Let's use recoveryParam and let serializeTransaction handle chainId part of v.
            };
            // For more explicit EIP-155 'v' calculation if needed by some part of ethers:
            // let chainId = txRequest?.chainId; // This function only signs digest, txRequest is not here
            // if (chainId) {
            //    ethersSignature.v = recoveryParam + (chainId * 2 + 35);
            // } else {
            //    ethersSignature.v = recoveryParam + 27;
            // }
            // However, ethers.Signature type expects recoveryParam (0 or 1) or the full v.
            // Using recoveryParam is generally safer with modern ethers.

            logger.info(`KmsService: Successfully signed digest. R: ${ethersSignature.r}, S: ${ethersSignature.s}, V_rec: ${ethersSignature.recoveryParam}`);
            return ethersSignature;

        } catch (error) {
            logger.error({ err: error }, "KmsService: Error signing digest with KMS.");
            return null;
        }
    }


    public async signEthereumTransaction(transactionRequest: providers.TransactionRequest): Promise<string | null> {
        logger.debug({ txData: transactionRequest }, "KmsService: Attempting to sign Ethereum transaction.");

        if (!transactionRequest.from) {
            const derivedAddress = await this.getEthereumAddress();
            if (derivedAddress) {
                transactionRequest.from = derivedAddress;
                logger.info(`KmsService: 'from' address automatically set to derived KMS address: ${derivedAddress}`);
            } else {
                logger.error("KmsService: Cannot sign transaction without 'from' address and failed to derive one from KMS key.");
                return null;
            }
        }

        let numericNonce: number;
        if (transactionRequest.nonce !== undefined) {
            try {
                numericNonce = ethers.BigNumber.from(transactionRequest.nonce).toNumber();
            } catch (e) {
                logger.error({ err: e, originalNonce: transactionRequest.nonce }, "KmsService: Invalid nonce value, cannot convert to number.");
                return null;
            }
        } else {
            logger.error("KmsService: Transaction nonce is required for signing.");
            return null;
        }

        const transactionFieldsForSigning: ethersUtils.UnsignedTransaction = {
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

        Object.keys(transactionFieldsForSigning).forEach(keyStr => {
            const key = keyStr as keyof ethersUtils.UnsignedTransaction;
            if (transactionFieldsForSigning[key] === undefined) {
                delete transactionFieldsForSigning[key];
            }
        });

        const unsignedTx = ethersUtils.serializeTransaction(transactionFieldsForSigning);
        const txDigest = ethersUtils.keccak256(unsignedTx);

        const signature = await this.signTransactionDigest(txDigest);

        if (!signature) {
            logger.error("KmsService: Failed to obtain signature for the transaction digest.");
            return null;
        }

        return ethersUtils.serializeTransaction(transactionFieldsForSigning, signature);
    }
}