import assertRevert from './helpers/assertRevert'
import mintableTokenTests from './token/MintableToken';
import burnableTokenTests from './token/BurnableToken';
import standardTokenTests from './token/StandardToken';
import basicTokenTests from './token/BasicToken';
const Registry = artifacts.require('Registry')

const bytes32 = require('./helpers/bytes32.js')
const BN = web3.utils.toBN;
import assertBalance from './helpers/assertBalance'

function compliantTokenTests([owner, oneHundred, anotherAccount], transfersToZeroBecomeBurns = false) {
    describe('--CompliantToken Tests--', function () {
        const notes = bytes32("some notes")

        describe('minting', function () {
            describe('when user is on mint whitelist', function () {
                beforeEach(async function () {
                    await this.registry.setAttribute(anotherAccount, bytes32("hasPassedKYC/AML"), 1, notes, { from: owner })
                })

                mintableTokenTests([owner, oneHundred, anotherAccount])
            })

            it('rejects mint when user is not on mint whitelist', async function () {
                await assertRevert(this.token.mint(anotherAccount, BN(100*10**18), { from: owner }))
            })

            it('rejects mint when user is blacklisted', async function () {
                await this.registry.setAttribute(anotherAccount, bytes32("hasPassedKYC/AML"), 1, notes, { from: owner })
                await this.registry.setAttribute(anotherAccount, bytes32("isBlacklisted"), 1, notes, { from: owner })
                await assertRevert(this.token.mint(anotherAccount, BN(100*10**18), { from: owner }))
            })
        })

        describe('burning', function () {
            describe('when user is on burn whitelist', function () {
                beforeEach(async function () {
                    await this.registry.setAttribute(oneHundred, bytes32("canBurn"), 1, notes, { from: owner })
                })

                burnableTokenTests([owner, oneHundred, anotherAccount], transfersToZeroBecomeBurns)

                it('rejects burn when user is on blacklist', async function () {
                    await this.registry.setAttribute(oneHundred, bytes32("isBlacklisted"), 1, notes, { from: owner })
                    await assertRevert(this.token.burn(BN(20*10**18), { from: oneHundred }))
                })
            })

            it('rejects burn when user is not on burn whitelist', async function () {
                await assertRevert(this.token.burn(BN(20*10**18), { from: oneHundred }))
            })
        })

        if (transfersToZeroBecomeBurns) {
            describe('transfers to 0x0 become burns', function () {
                const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
                describe('burning', function () {
                    describe('when user is on burn whitelist', function () {
                        beforeEach(async function () {
                            await this.registry.setAttribute(oneHundred, bytes32("canBurn"), 1, notes, { from: owner })
                        })

                        burnableTokenTests([owner, oneHundred, anotherAccount], transfersToZeroBecomeBurns)

                        it('rejects burn when user is on blacklist', async function () {
                            await this.registry.setAttribute(oneHundred, bytes32("isBlacklisted"), 1, notes, { from: owner })
                            await assertRevert(this.token.transfer(ZERO_ADDRESS, BN(20*10**18), { from: oneHundred }))
                        })
                    })

                    it('rejects burn when user is not on burn whitelist', async function () {
                        await assertRevert(this.token.transfer(ZERO_ADDRESS, BN(20*10**18), { from: oneHundred }))
                    })
                })
            })
        }

        describe('transferring', function () {
            describe('when user is not on blacklist', function () {
                basicTokenTests([owner, oneHundred, anotherAccount], transfersToZeroBecomeBurns)
                standardTokenTests([owner, oneHundred, anotherAccount])
            })

            describe('when user is on blacklist', function () {
                it('rejects transfer from blacklisted account', async function () {
                    await this.registry.setAttribute(oneHundred, bytes32("isBlacklisted"), 1, notes, { from: owner })
                    await assertRevert(this.token.transfer(anotherAccount, BN(100*10**18), { from: oneHundred }))
                })

                it('rejects transfer to blacklisted account', async function () {
                    await this.registry.setAttribute(anotherAccount, bytes32("isBlacklisted"), 1, notes, { from: owner })
                    await assertRevert(this.token.transfer(anotherAccount, BN(100*10**18), { from: oneHundred }))
                })

                it('rejects transferFrom to blacklisted account', async function () {
                    await this.registry.setAttribute(oneHundred, bytes32("isBlacklisted"), 1, notes, { from: owner })
                    await this.token.approve(anotherAccount, BN(100*10**18), { from: oneHundred })
                    await assertRevert(this.token.transferFrom(oneHundred, owner, BN(100*10**18), { from: anotherAccount }))
                })

                it('rejects transferFrom by blacklisted spender', async function () {
                    await this.registry.setAttribute(anotherAccount, bytes32("isBlacklisted"), 1, notes, { from: owner })
                    await this.token.approve(anotherAccount, BN(100*10**18), { from: oneHundred })
                    await assertRevert(this.token.transferFrom(oneHundred, owner, BN(100*10**18), { from: anotherAccount }))
                })
            })
        })

        describe('CanWriteTo-', function (){
            beforeEach(async function () {
                const canWriteToKYCAttribute = await this.registry.writeAttributeFor.call(bytes32("hasPassedKYC/AML"))
                await this.registry.setAttribute(oneHundred, canWriteToKYCAttribute, 1, notes, { from: owner })
            })

            it('address other than the owner can write attribute if they have canWrite access', async function(){
                await this.registry.setAttribute(anotherAccount, bytes32("hasPassedKYC/AML"), 1, notes, { from: oneHundred })
            })
        })

        describe('wipe account', function () {
            beforeEach(async function () {
                await this.registry.setAttribute(oneHundred, bytes32("isBlacklisted"), 1, notes, { from: owner })
            })

            it('will not wipe non-blacklisted account', async function () {
                await this.registry.setAttribute(oneHundred, bytes32("isBlacklisted"), 0, notes, { from: owner })
                await assertRevert(this.token.wipeBlacklistedAccount(oneHundred, { from: owner }))
            })

            it('sets balance to 0', async function () {
                await this.token.wipeBlacklistedAccount(oneHundred, { from: owner })
                await assertBalance(this.token, oneHundred, 0);
            })

            it('emits events', async function () {
                const { logs } = await this.token.wipeBlacklistedAccount(oneHundred, { from: owner })

                assert.equal(logs.length, 2)
                assert.equal(logs[0].event, 'WipeBlacklistedAccount')
                assert.equal(logs[0].args.account, oneHundred)
                assert(logs[0].args.balance.eq(BN(100*10**18)))
                assert.equal(logs[1].event, 'Transfer')
                assert(logs[1].args.value.eq(BN(100*10**18)))
                assert.equal(logs[1].args.to, 0)
                assert.equal(logs[1].args.from, oneHundred)
            })

            it('cannot be called by non-owner', async function () {
                await assertRevert(this.token.wipeBlacklistedAccount(oneHundred, { from: anotherAccount }))
            })
        })
    })

}

export default compliantTokenTests
