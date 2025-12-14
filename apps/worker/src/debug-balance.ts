
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';

const RPC_URL = "https://rpc.monad.xyz";
const CHOG_CONTRACT = "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777";
const WALLET = "0x3b3629a77dd4e82229c812a489ff93bbde64cf3b";

const ERC20_ABI = parseAbi([
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
]);

async function checkBalance() {
    console.log(`Checking balance for ${WALLET} on ${RPC_URL}`);
    console.log(`Contract: ${CHOG_CONTRACT}`);

    const client = createPublicClient({
        transport: http(RPC_URL),
    });

    try {
        const decimals = await client.readContract({
            address: CHOG_CONTRACT as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'decimals',
        });
        console.log(`Decimals: ${decimals}`);

        const balance = await client.readContract({
            address: CHOG_CONTRACT as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [WALLET as `0x${string}`],
        });

        console.log(`Raw Balance: ${balance}`);
        console.log(`Formatted Balance: ${formatUnits(balance, decimals)}`);
    } catch (error) {
        console.error("Error fetching balance:", error);
    }
}

checkBalance();
