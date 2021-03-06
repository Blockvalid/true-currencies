// types and values
const to18Decimals = value => BN(Math.floor(value * 10 ** 10)).mul(BN(10 ** 8))
const to27Decimals = value => BN(Math.floor(value * 10 ** 10)).mul(BN(10 ** 17))
const bytes32 = require('../helpers/bytes32.js')
const Types = artifacts.require('Types')
const BN = web3.utils.toBN
const ONE_ETHER = BN(1e18)
const ONE_HUNDRED_ETHER = BN(100).mul(ONE_ETHER)
const ONE_BITCOIN = BN(1e8)
const ONE_HUNDRED_BITCOIN = BN(100).mul(ONE_BITCOIN)

// Liquidator Dependencies
const TrueUSDMock = artifacts.require('TrueUSDMock')
const Liquidator = artifacts.require('Liquidator')
const MockTrustToken = artifacts.require('MockTrustToken')
const Airswap = artifacts.require('Swap')
const AirswapERC20TransferHandler = artifacts.require('AirswapERC20TransferHandler')
const TransferHandlerRegistry = artifacts.require('TransferHandlerRegistry')
const UniswapFactory = artifacts.require('uniswap_factory')
const UniswapExchange = artifacts.require('uniswap_exchange')
const { hashDomain } = require('../lib/airswap.js')
const ERC20_KIND = '0x36372b07'
const AIRSWAP_VALIDATOR = bytes32('AirswapValidatorDomain')
const APPROVED_BENEFICIARY = bytes32('approvedBeneficiary')

// staking dependencies
const StakedToken = artifacts.require('StakedToken')
const IS_REGISTERED_CONTRACT = bytes32('isRegisteredContract')
const PASSED_KYCAML = bytes32('hasPassedKYC/AML')

// opportunities dependencies
const Registry = artifacts.require('RegistryMock')
const ATokenMock = artifacts.require('ATokenMock')
const LendingPoolMock = artifacts.require('LendingPoolMock')
const LendingPoolCoreMock = artifacts.require('LendingPoolCoreMock')
const AaveFinancialOpportunity = artifacts.require('AaveFinancialOpportunity')
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy')

// assured financial opportunities dependencies
const AssuredFinancialOpportunity = artifacts.require('AssuredFinancialOpportunity')
const FractionalExponents = artifacts.require('FractionalExponents')

contract.skip('AssuredFinancialOpportunity', function (accounts) {
  const [, owner, issuer, oneHundred, approvedBeneficiary,
    holder, holder2, kycAccount] = accounts
  // const kycAccount = '0x835c247d2f6524009d38dc52d95a929f62888df6'
  describe('TrueReward setup', function () {
    beforeEach(async function () {
      // Liquidation Setup
      this.uniswapFactory = await UniswapFactory.new()
      this.uniswapTemplate = await UniswapExchange.new()
      this.uniswapFactory.initializeFactory(this.uniswapTemplate.address)
      this.registry = await Registry.new({ from: owner })
      this.token = await TrueUSDMock.new(holder, to18Decimals(400), { from: issuer })
      this.stakeToken = await MockTrustToken.new(this.registry.address, { from: issuer })
      this.outputUniswapAddress = (await this.uniswapFactory.createExchange(this.token.address)).logs[0].args.exchange
      this.outputUniswap = await UniswapExchange.at(this.outputUniswapAddress)
      this.stakeUniswap = await UniswapExchange.at((await this.uniswapFactory.createExchange(this.stakeToken.address)).logs[0].args.exchange)
      await this.token.setRegistry(this.registry.address, { from: issuer })
      await this.token.mint(oneHundred, ONE_HUNDRED_ETHER, { from: issuer })
      await this.stakeToken.mint(oneHundred, ONE_HUNDRED_ETHER, { from: issuer })
      this.transferHandler = await AirswapERC20TransferHandler.new({ from: owner })
      this.transferHandlerRegistry = await TransferHandlerRegistry.new({ from: owner })
      this.transferHandlerRegistry.addTransferHandler(ERC20_KIND, this.transferHandler.address, { from: owner })
      this.types = await Types.new()
      await Airswap.link('Types', this.types.address)
      await this.token.approve(this.outputUniswap.address, ONE_HUNDRED_ETHER, { from: oneHundred })
      await this.stakeToken.approve(this.stakeUniswap.address, ONE_HUNDRED_ETHER, { from: oneHundred })
      const expiry = parseInt(Date.now() / 1000) + 12000
      await this.outputUniswap.addLiquidity(ONE_HUNDRED_ETHER, ONE_HUNDRED_ETHER, expiry, { from: oneHundred, value: 1e17 })
      await this.stakeUniswap.addLiquidity(ONE_HUNDRED_ETHER, ONE_HUNDRED_ETHER, expiry, { from: oneHundred, value: 1e17 })
      await this.token.mint(oneHundred, ONE_HUNDRED_ETHER, { from: issuer })
      await this.stakeToken.mint(oneHundred, ONE_HUNDRED_ETHER, { from: issuer })
      this.airswap = await Airswap.new(this.transferHandlerRegistry.address, { from: owner })
      this.liquidator = await Liquidator.new(this.registry.address, this.token.address, this.stakeToken.address, this.outputUniswap.address, this.stakeUniswap.address, { from: owner })

      // Setup Staking Pool
      this.pool = await StakedToken.new(this.stakeToken.address, this.token.address,
        this.registry.address, this.liquidator.address, { from: owner })
      await this.token.setRegistry(this.registry.address, { from: issuer })
      await this.token.mint(oneHundred, ONE_HUNDRED_ETHER, { from: issuer })
      await this.stakeToken.mint(oneHundred, ONE_HUNDRED_BITCOIN, { from: issuer })

      // await this.registry.subscribe(PASSED_KYCAML, this.pool.address, {from: owner})
      await this.registry.setAttributeValue(kycAccount, PASSED_KYCAML, 1, { from: owner })
      await this.registry.subscribe(IS_REGISTERED_CONTRACT, this.stakeToken.address, { from: owner })
      await this.registry.subscribe(IS_REGISTERED_CONTRACT, this.token.address, { from: owner })
      await this.registry.setAttributeValue(this.pool.address, IS_REGISTERED_CONTRACT, 1, { from: owner })

      // More setup for liquidator
      await this.liquidator.setPool(this.pool.address, { from: owner })
      await this.registry.subscribe(AIRSWAP_VALIDATOR, this.liquidator.address, { from: owner })
      await this.registry.subscribe(APPROVED_BENEFICIARY, this.liquidator.address, { from: owner })
      await this.registry.setAttributeValue(this.airswap.address, AIRSWAP_VALIDATOR, hashDomain(this.airswap.address), { from: owner })
      await this.registry.setAttributeValue(approvedBeneficiary, APPROVED_BENEFICIARY, 1, { from: owner })
      await this.token.approve(this.airswap.address, ONE_HUNDRED_ETHER, { from: oneHundred })

      this.lendingPoolCore = await LendingPoolCoreMock.new({ from: owner })
      this.sharesToken = await ATokenMock.new(this.token.address, this.lendingPoolCore.address, { from: owner })
      this.lendingPool = await LendingPoolMock.new(this.lendingPoolCore.address, this.sharesToken.address, { from: owner })

      await this.token.transfer(this.sharesToken.address, to18Decimals(100), { from: holder })

      this.financialOpportunityImpl = await AaveFinancialOpportunity.new({ from: owner })
      this.financialOpportunityProxy = await OwnedUpgradeabilityProxy.new({ from: owner })
      this.financialOpportunity = await AaveFinancialOpportunity.at(this.financialOpportunityProxy.address)
      await this.financialOpportunityProxy.upgradeTo(this.financialOpportunityImpl.address, { from: owner })

      // setup assured opportunity
      this.exponentContract = await FractionalExponents.new({ from: owner })

      this.assuredFinancialOpportunityImplementation = await AssuredFinancialOpportunity.new({ from: owner })

      this.assuredFinancialOpportunityProxy = await OwnedUpgradeabilityProxy.new({ from: owner })
      this.assuredFinancialOpportunity = await AssuredFinancialOpportunity.at(this.assuredFinancialOpportunityProxy.address)
      await this.assuredFinancialOpportunityProxy.upgradeTo(this.assuredFinancialOpportunityImplementation.address, { from: owner })

      await this.assuredFinancialOpportunity.configure(
        this.financialOpportunity.address,
        this.pool.address,
        this.liquidator.address,
        this.exponentContract.address,
        this.token.address,
        this.token.address,
        { from: owner },
      )

      await this.token.setFinOpAddress(this.assuredFinancialOpportunity.address, { from: issuer })
      await this.financialOpportunity.configure(
        this.sharesToken.address, this.lendingPool.address, this.token.address, this.assuredFinancialOpportunity.address, { from: owner },
      )
      await this.liquidator.transferOwnership(this.assuredFinancialOpportunity.address, { from: owner })
    })

    it('enables truereward', async function () {
      await this.token.transfer(holder2, to18Decimals(100), { from: holder })
      const interfaceSharesTokenBalance = await this.sharesToken.balanceOf.call(this.assuredFinancialOpportunity.address)
      assert.equal(interfaceSharesTokenBalance, 0)
      await this.token.enableTrueReward({ from: holder2 })
      const enabled = await this.token.trueRewardEnabled.call(holder2)
      assert.equal(enabled, true)
      const loanBackedTokenBalance = await this.token.accountTotalLoanBackedBalance.call(holder2)
      const finOpSupply = await this.token.finOpSupply.call()
      const totalSupply = await this.token.totalSupply.call()
      const balance = await this.token.balanceOf.call(holder2)
      assert.equal(loanBackedTokenBalance, to18Decimals(100))
      assert.equal(finOpSupply, to18Decimals(100))
      assert.equal(totalSupply, to18Decimals(800))
      assert.equal(balance, to18Decimals(100))
    })

    it('disables truereward', async function () {
      await this.token.transfer(holder2, to18Decimals(100), { from: holder })
      await this.token.enableTrueReward({ from: holder2 })
      let enabled = await this.token.trueRewardEnabled.call(holder2)
      assert.equal(enabled, true)
      await this.token.disableTrueReward({ from: holder2 })
      enabled = await this.token.trueRewardEnabled.call(holder2)
      assert.equal(enabled, false)
    })

    it('calculate interest correctly', async function () {
      let totalSupply = await this.token.totalSupply.call()
      assert.equal(totalSupply, to18Decimals(700))
      await this.assuredFinancialOpportunity.setRewardBasis(0.7 * 1000, { from: owner })
      await this.lendingPoolCore.setReserveNormalizedIncome(to27Decimals(1.5), { from: owner })
      await this.token.transfer(holder2, to18Decimals(100), { from: holder })
      await this.token.enableTrueReward({ from: holder2 })
      const loanBackedTokenBalance = await this.token.accountTotalLoanBackedBalance.call(holder2)
      const finOpSupply = await this.token.finOpSupply.call()
      totalSupply = await this.token.totalSupply.call()
      let balance = await this.token.balanceOf.call(holder2)
      assert.equal(loanBackedTokenBalance, 75289795697123700000)
      assert.equal(finOpSupply, 75289795697123700000)
      assert.equal(totalSupply, to18Decimals(800))
      assert.equal(balance, to18Decimals(100))
      await this.lendingPoolCore.setReserveNormalizedIncome(to27Decimals(1.6), { from: owner })
      totalSupply = await this.token.totalSupply.call()
      balance = await this.token.balanceOf.call(holder2)
      assert.equal(totalSupply, 804621298639582300000)
      assert.equal(balance, 104621298639582200000)
    })

    // it('reward', async function() {

    // })
    // it('stake', async function() {

    // })
    // it('liquidate', async function() {

    // })
  })
})
