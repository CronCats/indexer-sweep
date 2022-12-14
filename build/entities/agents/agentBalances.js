"use strict";
// agents (extra detail)
// agent_balances table
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveAgentBalances = void 0;
const utils_1 = require("../../utils");
const variables_1 = require("../../variables");
const query_1 = require("cosmjs-types/cosmos/bank/v1beta1/query");
const saveAgentBalances = async (agentAddress, rowId, blockInfo) => {
    const blockHeight = Number.parseInt(blockInfo.height);
    // Query the smart contract for agent details at a specific height
    const queryGetAgentReadable = {
        get_agent: {
            account_id: agentAddress // named params
        }
    };
    const managerAddress = variables_1.settings.contracts.manager.address;
    const contractBalances = await (0, utils_1.queryContractAtHeight)(managerAddress, queryGetAgentReadable, blockHeight);
    (0, utils_1.v)('agent info', contractBalances);
    let promises = [];
    console.log('aloha register_start', contractBalances.register_start);
    promises.push((0, variables_1.db)('agents').update({
        payable_account_id: contractBalances.payable_account_id,
        total_tasks_executed: contractBalances.total_tasks_executed,
        last_executed_slot: contractBalances.last_executed_slot,
        // Nanoseconds are too granular, divide by 10^6
        register_start: new Date(contractBalances.register_start / 1000000).toISOString()
    }).where('id', rowId));
    // Add manager contract state to DB
    // 1/2 Native balances
    for (const nativeBalance of contractBalances.balance.native) {
        promises.push((0, variables_1.db)('agent_balances').insert({
            fk_agent_id: rowId,
            type: 'manager-state',
            denom: nativeBalance.denom,
            amount: nativeBalance.amount
        }));
    }
    // 2/2 cw20's (as stored in state for the contract)
    for (const contractBalance of contractBalances.balance.cw20) {
        promises.push((0, variables_1.db)('agent_balances').insert({
            fk_agent_id: rowId,
            type: 'manager-state',
            address: contractBalance.address,
            amount: contractBalance.amount
        }));
    }
    await Promise.all(promises);
    // Reset promises
    promises = [];
    // Get token balances from protocol at a given height
    const requestProtocolData = Uint8Array.from(query_1.QueryAllBalancesRequest.encode({ address: agentAddress }).finish());
    const protocol_balances_encoded = await variables_1.tmClientQuery.queryUnverified(`/cosmos.bank.v1beta1.Query/AllBalances`, requestProtocolData, Number.parseInt(blockInfo.height));
    const protocol_balances = query_1.QueryAllBalancesResponse.decode(protocol_balances_encoded);
    // We're assuming there is no pagination :/. come fix it friend?
    for (const balance of protocol_balances.balances) {
        promises.push((0, variables_1.db)('agent_balances').insert({
            fk_agent_id: rowId,
            type: 'protocol',
            denom: balance.denom,
            amount: balance.amount
        }));
    }
    await Promise.all(promises);
    // TODO: (!!!)
    // This might be kinda helpful
    // Ensure we've paginated through all protocol balances
    // const allBalances = [];
    // let startAtKey
    // do {
    //     const { balances, pagination } = protocol_balances
    //     const loadedBalances = balances || [];
    //     allBalances.push(...loadedBalances);
    //     startAtKey = pagination?.nextKey;
    // } while (startAtKey?.length !== 0);
};
exports.saveAgentBalances = saveAgentBalances;
