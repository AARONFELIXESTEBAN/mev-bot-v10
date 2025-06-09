import { ethers } from 'ethers';

export class RpcService {
    getProvider(network: string, type: 'http' | 'ws'): ethers.JsonRpcProvider {
        throw new Error('getProvider not implemented');
    }

    async getFeeData(network: string): Promise<{
        lastBaseFeePerGas?: ethers.BigNumberish;
        maxPriorityFeePerGas?: ethers.BigNumberish;
    }> {
        throw new Error('getFeeData not implemented');
    }
}