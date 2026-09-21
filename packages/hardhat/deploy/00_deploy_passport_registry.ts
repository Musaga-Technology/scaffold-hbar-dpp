import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "ethers";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";

/**
 * Deploys the PassportRegistry.
 *
 * The second constructor argument is the HTS system contract address; passing the
 * zero address selects the real one at 0x167. Tests inject MockHTS instead.
 *
 * Deploying alone does not produce a usable registry — the collection still has to
 * be created and a product registered. `yarn passport:bootstrap` runs this deploy
 * and then does both, which is why it is the documented entry point.
 */
const deployPassportRegistry: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("PassportRegistry", {
    from: deployer,
    args: [deployer, ethers.ZeroAddress],
    log: true,
    autoMine: true,
    gasLimit: "3000000",
    gasPrice: await getDeployGasPrice(hre),
  });
};

deployPassportRegistry.tags = ["PassportRegistry"];
export default deployPassportRegistry;
