// Import các thư viện cần thiết
const fs = require('fs');
const { ethers, JsonRpcProvider } = require('ethers');
const readline = require('readline');
const chalk = require('chalk');
const solc = require('solc');
const HttpsProxyAgent = require('https-proxy-agent');

// Cấu hình mạng Tea Sepolia
const networkConfig = {
    name: 'Tea Sepolia',
    chainId: 10218,
    rpcUrl: 'https://tea-sepolia.g.alchemy.com/public',
    currencySymbol: 'TEA',
    explorerUrl: 'https://sepolia.tea.xyz'
};

// Hàm đọc file với xử lý lỗi
const readFileLines = async (filename) => {
    try {
        const fileStream = fs.createReadStream(filename);
        const lines = [];
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            lines.push(line.trim());
        }
        return lines;
    } catch (error) {
        throw new Error(`Không thể đọc file ${filename}: ${error.message}`);
    }
};

// Hàm tạo provider với proxy
const createProviderWithProxy = (proxyUrl) => {
    const agent = new HttpsProxyAgent(proxyUrl);
    return new JsonRpcProvider(networkConfig.rpcUrl, undefined, { httpAgent: agent });
};

// Hàm tạo số lượng token ngẫu nhiên
const getRandomAmount = () => {
    const min = 0.00001;
    const max = 0.001;
    const random = Math.random() * (max - min) + min;
    return ethers.parseEther(random.toFixed(6));
};

// Hàm tạo delay ngẫu nhiên từ 2 đến 10 giây
const getRandomDelay = () => {
    const min = 2; // giây
    const max = 10; // giây
    return Math.floor(Math.random() * (max - min + 1) + min) * 1000; // Chuyển sang milliseconds
};

// Hàm kiểm tra số dư TEA
const checkBalance = async (privateKey, proxyUrl) => {
    try {
        const provider = proxyUrl ? createProviderWithProxy(proxyUrl) : new JsonRpcProvider(networkConfig.rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const balance = await provider.getBalance(wallet.address);
        return {
            address: wallet.address,
            balance: ethers.formatEther(balance),
            provider
        };
    } catch (error) {
        throw new Error(`Lỗi khi kiểm tra số dư: ${error.message}`);
    }
};

// Hàm gửi token TEA
const sendToken = async (privateKey, recipientAddress, proxyUrl) => {
    try {
        const provider = proxyUrl ? createProviderWithProxy(proxyUrl) : new JsonRpcProvider(networkConfig.rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const amount = getRandomAmount();

        // Kiểm tra số dư
        const balance = await provider.getBalance(wallet.address);
        if (balance < amount) {
            console.log(chalk.red(`Số dư không đủ trong ví ${wallet.address}: ${ethers.formatEther(balance)} TEA`));
            return false;
        }

        console.log(chalk.yellow(`Đang thực hiện giao dịch từ ví ${wallet.address} tới ${recipientAddress}${proxyUrl ? ` qua proxy ${proxyUrl}` : ''}...`));
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice;

        const tx = {
            to: recipientAddress,
            value: amount,
            gasLimit: 21000,
            gasPrice: gasPrice
        };

        const transaction = await wallet.sendTransaction(tx);
        console.log(chalk.green(`Gửi ${ethers.formatEther(amount)} TEA từ ${wallet.address} tới ${recipientAddress}`));
        console.log(chalk.cyan(`Tx Hash: ${transaction.hash}`));
        console.log(chalk.cyan(`Xem giao dịch: ${networkConfig.explorerUrl}/tx/${transaction.hash}`));
        
        await transaction.wait();
        console.log(chalk.green('Giao dịch đã được xác nhận'));
        return true;
    } catch (error) {
        console.error(chalk.red(`Lỗi khi gửi token tới ${recipientAddress}: ${error.message}`));
        return false;
    }
};

// Hàm deploy smart contract ERC20
const deployContract = async (privateKey, proxyUrl) => {
    try {
        const provider = proxyUrl ? createProviderWithProxy(proxyUrl) : new JsonRpcProvider(networkConfig.rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        
        const contractSource = fs.readFileSync('auto.sol', 'utf8');
        const input = {
            language: 'Solidity',
            sources: {
                'auto.sol': { content: contractSource }
            },
            settings: {
                outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
            }
        };

        const output = JSON.parse(solc.compile(JSON.stringify(input)));
        const contractName = Object.keys(output.contracts['auto.sol'])[0];
        const contractData = output.contracts['auto.sol'][contractName];

        if (!contractData.evm.bytecode.object) {
            console.log(chalk.red('❌ Biên dịch smart contract thất bại! Vui lòng kiểm tra code Solidity.'));
            return;
        }

        const contractFactory = new ethers.ContractFactory(contractData.abi, contractData.evm.bytecode.object, wallet);

        console.log(chalk.yellow(`⏳ Đang deploy smart contract${proxyUrl ? ` qua proxy ${proxyUrl}` : ''}...`));
        const contract = await contractFactory.deploy('MyToken', 'MTK', 1000000, wallet.address);
        await contract.waitForDeployment();

        const contractAddress = await contract.getAddress();
        console.log(chalk.green(`✅ Smart contract đã được deploy! Địa chỉ: ${chalk.blue(contractAddress)}`));
        console.log(chalk.cyan(`Xem smart contract: ${networkConfig.explorerUrl}/address/${contractAddress}`));
    } catch (error) {
        console.error(chalk.red(`❌ Deploy smart contract thất bại: ${error.message}`));
    }
};

// Hàm hỏi người dùng
const askQuestion = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(query, answer => {
        rl.close();
        resolve(answer);
    }));
};

// Hàm chính
const main = async () => {
    try {
        const privateKeys = await readFileLines('privatekey.txt');
        const addresses = await readFileLines('visend.txt');
        let proxies = [];
        const useProxy = await askQuestion(chalk.magenta('Bạn muốn sử dụng proxy không? (y/n): '));
        if (useProxy.toLowerCase() === 'y') {
            proxies = await readFileLines('proxy.txt').catch(() => {
                console.log(chalk.yellow('Không tìm thấy file proxy.txt, tiếp tục không dùng proxy.'));
                return [];
            });
        }

        console.log(chalk.blue.bold('Danh sách ví có sẵn:'));
        const walletsInfo = [];
        for (let i = 0; i < privateKeys.length; i++) {
            const proxyUrl = (useProxy.toLowerCase() === 'y' && proxies[i]) ? proxies[i] : null;
            const { address, balance } = await checkBalance(privateKeys[i], proxyUrl);
            walletsInfo.push({ privateKey: privateKeys[i], address, txCount: 0, proxyUrl });
            console.log(chalk.blue(`${i + 1}. Ví ${i + 1} - Địa chỉ: ${address} - Số dư: ${balance} TEA${proxyUrl ? ` - Proxy: ${proxyUrl}` : ''}`));
        }

        console.log(chalk.magenta.bold('\nChọn tùy chọn:'));
        console.log(chalk.yellow('1. Gửi TEA tới các địa chỉ'));
        console.log(chalk.yellow('2. Deploy smart contract ERC20'));
        const choice = await askQuestion(chalk.magenta('Nhập lựa chọn (1 hoặc 2): '));

        if (choice === '2') {
            const walletChoice = await askQuestion(chalk.magenta('Chọn ví để deploy smart contract (1, 2, 3,...): '));
            const walletIndex = parseInt(walletChoice) - 1;
            if (walletIndex >= 0 && walletIndex < walletsInfo.length) {
                await deployContract(walletsInfo[walletIndex].privateKey, walletsInfo[walletIndex].proxyUrl);
            } else {
                console.log(chalk.red('Lựa chọn ví không hợp lệ!'));
            }
            return;
        } else if (choice === '1') {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const walletChoice = await new Promise((resolve) => {
                rl.question(chalk.magenta('Chọn ví gửi (1, 2, 3,... hoặc "all" để dùng tất cả ví): '), resolve);
            });

            let selectedWallets = [];
            if (walletChoice.toLowerCase() === 'all') {
                selectedWallets = walletsInfo;
            } else {
                const walletIndex = parseInt(walletChoice) - 1;
                if (walletIndex >= 0 && walletIndex < walletsInfo.length) {
                    selectedWallets = [walletsInfo[walletIndex]];
                } else {
                    console.log(chalk.red('Lựa chọn ví không hợp lệ!'));
                    rl.close();
                    return;
                }
            }

            console.log(chalk.magenta.bold('Chọn chế độ gửi TEA:'));
            console.log(chalk.yellow('1. Số giao dịch cho mỗi địa chỉ (mặc định mỗi ví của bạn sẽ chạy hết trong danh sách visend.txt)'));
            console.log(chalk.yellow('2. Tổng số giao dịch cố định cho mỗi ví'));
            const modeChoice = await new Promise((resolve) => {
                rl.question(chalk.magenta('Nhập lựa chọn (1 hoặc 2): '), resolve);
            });

            let txPerAddress = 0;
            let totalTxPerWallet = 0;
            let loopCount = 1;

            if (modeChoice === '1') {
                txPerAddress = await new Promise((resolve) => {
                    rl.question(chalk.magenta('Nhập số lượng giao dịch cho mỗi địa chỉ từ mỗi ví: '), (answer) => {
                        resolve(parseInt(answer) || 1);
                    });
                });

                loopCount = await new Promise((resolve) => {
                    rl.question(chalk.magenta('Nhập số lần lặp lại toàn bộ quá trình (mặc định 1 nếu để trống): '), (answer) => {
                        resolve(parseInt(answer) || 1);
                    });
                });
            } else if (modeChoice === '2') {
                const txOptions = await new Promise((resolve) => {
                    rl.question(chalk.magenta('Nhập tổng số giao dịch cho mỗi ví (10, 20, 50 hoặc số tùy chỉnh): '), resolve);
                });
                totalTxPerWallet = parseInt(txOptions) || 10; // Mặc định 10 nếu nhập sai
            } else {
                console.log(chalk.red('Lựa chọn chế độ không hợp lệ!'));
                rl.close();
                return;
            }

            console.log(chalk.blue.bold(`\nBắt đầu gửi TEA từ ${selectedWallets.length} ví:`));
            if (modeChoice === '1') {
                // Chế độ 1: Gửi theo số giao dịch cho mỗi địa chỉ
                for (let loop = 1; loop <= loopCount; loop++) {
                    console.log(chalk.blue.bold(`\nVòng lặp ${loop}/${loopCount}:`));
                    for (let i = 0; i < addresses.length; i++) {
                        const recipientAddress = addresses[i];
                        if (!ethers.isAddress(recipientAddress)) {
                            console.log(chalk.red(`Địa chỉ ${recipientAddress} không hợp lệ, bỏ qua...`));
                            continue;
                        }

                        console.log(chalk.blue(`\nXử lý địa chỉ ${recipientAddress} (${i + 1}/${addresses.length}):`));
                        for (let j = 0; j < selectedWallets.length; j++) {
                            const wallet = selectedWallets[j];
                            for (let tx = 1; tx <= txPerAddress; tx++) {
                                const totalTxLimit = txPerAddress * addresses.length * loopCount;
                                if (wallet.txCount >= totalTxLimit) {
                                    console.log(chalk.yellow(`Ví ${wallet.address} đã đạt giới hạn giao dịch`));
                                    continue;
                                }

                                const success = await sendToken(wallet.privateKey, recipientAddress, wallet.proxyUrl);
                                if (success) {
                                    wallet.txCount++;
                                    console.log(chalk.green(`Ví ${wallet.address} - Giao dịch ${wallet.txCount}/${totalTxLimit} tới ${recipientAddress}`));
                                } else {
                                    console.log(chalk.yellow(`Bỏ qua giao dịch từ ${wallet.address} tới ${recipientAddress} do lỗi hoặc số dư không đủ`));
                                }

                                const delay = getRandomDelay();
                                console.log(chalk.gray(`Đợi ${delay / 1000} giây trước giao dịch tiếp theo...`));
                                await new Promise(resolve => setTimeout(resolve, delay));
                            }
                        }
                    }
                }
            } else if (modeChoice === '2') {
                // Chế độ 2: Gửi tổng số giao dịch cố định cho mỗi ví
                for (let j = 0; j < selectedWallets.length; j++) {
                    const wallet = selectedWallets[j];
                    console.log(chalk.blue.bold(`\nXử lý ví ${wallet.address}:`));
                    for (let tx = 1; tx <= totalTxPerWallet; tx++) {
                        if (wallet.txCount >= totalTxPerWallet) {
                            console.log(chalk.yellow(`Ví ${wallet.address} đã đạt giới hạn giao dịch`));
                            break;
                        }

                        const recipientAddress = addresses[Math.floor(Math.random() * addresses.length)];
                        if (!ethers.isAddress(recipientAddress)) {
                            console.log(chalk.red(`Địa chỉ ${recipientAddress} không hợp lệ, bỏ qua...`));
                            continue;
                        }

                        const success = await sendToken(wallet.privateKey, recipientAddress, wallet.proxyUrl);
                        if (success) {
                            wallet.txCount++;
                            console.log(chalk.green(`Ví ${wallet.address} - Giao dịch ${wallet.txCount}/${totalTxPerWallet} tới ${recipientAddress}`));
                        } else {
                            console.log(chalk.yellow(`Bỏ qua giao dịch từ ${wallet.address} tới ${recipientAddress} do lỗi hoặc số dư không đủ`));
                        }

                        const delay = getRandomDelay();
                        console.log(chalk.gray(`Đợi ${delay / 1000} giây trước giao dịch tiếp theo...`));
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }

            console.log(chalk.green.bold('\nĐã hoàn tất tất cả các giao dịch!'));
            rl.close();
        } else {
            console.log(chalk.red('Lựa chọn không hợp lệ!'));
            return;
        }
    } catch (error) {
        console.error(chalk.red('Lỗi:', error.message));
    }
};

// Khởi chạy chương trình
main();