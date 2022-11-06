"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveAgentBalances = exports.saveTaskDetails = exports.saveConfigDetails = exports.saveAgentDetails = exports.checkRowsToUpdate = void 0;
const utils_1 = require("./utils");
const query_1 = require("cosmjs-types/cosmos/bank/v1beta1/query");
const variables_1 = require("./variables");
const checkRowsToUpdate = async () => {
    // The main entities in CronCat are agents, tasks, and the contract's configuration
    await Promise.all([
        (0, exports.saveAgentDetails)(),
        (0, exports.saveTaskDetails)(),
        (0, exports.saveConfigDetails)()
    ]);
    // This line basically says, "do this all again after waiting a bit"
    // because we love our gracious RPC providers and want to reduce hammering them, even if it's a little
    // Uses this tactic: https://javascript.info/settimeout-setinterval#nested-settimeout
    (0, variables_1.updateStateTimerId)(setTimeout(exports.checkRowsToUpdate, variables_1.TIMEOUT));
};
exports.checkRowsToUpdate = checkRowsToUpdate;
const saveAgentDetails = async () => {
    const neededBlocks = await (0, variables_1.db)('agents').select('blocks.height', 'contract_block_piv.id')
        .rightJoin('contract_block_piv', 'contract_block_piv.id', 'agents.fk_cb_id')
        .innerJoin('blocks', 'contract_block_piv.fk_block_id', 'blocks.id')
        .whereNull('agents.id');
    // v('neededBlocks (agents)', neededBlocks)
    let promises = [];
    const queryAgentIdsReadable = {
        "get_agent_ids": {} // This means, "call the query function get_agent_ids with no parameters"
    };
    for (const blockInfo of neededBlocks) {
        const contractBlockIdFk = blockInfo.id;
        const blockHeight = Number.parseInt(blockInfo.height);
        const agentsJson = await (0, utils_1.queryContractAtHeight)(variables_1.settings.contracts.manager.address, queryAgentIdsReadable, blockHeight);
        // v('agentsJson', agentsJson)
        agentsJson.active.map(async (activeAgent) => {
            const activeId = await (0, variables_1.db)('agents')
                .insert({
                fk_cb_id: contractBlockIdFk,
                address: activeAgent,
                is_active: true,
                total_tasks_executed: agentsJson.total_tasks_executed,
                last_executed_slot: agentsJson.last_executed_slot,
                register_start: agentsJson.register_start,
                payable_account_id: agentsJson.payable_account_id
            }, 'id');
            // To get more detail on balances, we need to do a couple calls
            promises.push((0, exports.saveAgentBalances)(activeAgent, activeId[0].id, blockInfo));
        });
        agentsJson.pending.map(async (pendingAgent) => {
            const pendingId = await (0, variables_1.db)('agents')
                .insert({
                fk_block_id: contractBlockIdFk,
                address: pendingAgent,
                is_active: false,
                total_tasks_executed: agentsJson.total_tasks_executed,
                last_executed_slot: agentsJson.last_executed_slot,
                register_start: agentsJson.register_start,
                payable_account_id: agentsJson.payable_account_id
            }, 'id');
            promises.push((0, exports.saveAgentBalances)(pendingAgent, pendingId[0].id, blockInfo));
        });
    }
    await Promise.all(promises);
};
exports.saveAgentDetails = saveAgentDetails;
const saveConfigDetails = async () => {
    const neededBlocks = await (0, variables_1.db)('config').select('blocks.height', 'contract_block_piv.id')
        .rightJoin('contract_block_piv', 'contract_block_piv.id', 'config.fk_cb_id')
        .innerJoin('blocks', 'contract_block_piv.fk_block_id', 'blocks.id')
        .whereNull('config.id');
    // v('neededBlocks (config)', neededBlocks)
    let promises = [];
    const getConfig = {
        // get_config function takes no parameters, hence {} being an empty object where you'd normally put params
        get_config: {}
    };
    for (const blockInfo of neededBlocks) {
        const blockHeight = Number.parseInt(blockInfo.height);
        const contractBlockIdFk = blockInfo.id;
        promises.push(saveConfig(variables_1.settings.contracts.manager.address, getConfig, blockHeight, contractBlockIdFk));
    }
    await Promise.all(promises);
};
exports.saveConfigDetails = saveConfigDetails;
const saveConfig = async (contractAddress, getConfig, blockHeight, contractBlockIdFk) => {
    const config = await (0, utils_1.queryContractAtHeight)(contractAddress, getConfig, blockHeight);
    // v('config', config)
    // Insert row into config
    const configFkId = await (0, variables_1.db)('config').insert({
        fk_cb_id: contractBlockIdFk,
        paused: config.paused,
        owner_id: config.owner_id,
        min_tasks_per_agent: config.min_tasks_per_agent,
        agent_fee: config.agent_fee,
        gas_fraction_numerator: config.gas_fraction.numerator,
        gas_fraction_denominator: config.gas_fraction.denominator,
        gas_base_fee: config.gas_base_fee,
        gas_action_fee: config.gas_action_fee,
        proxy_callback_gas: config.proxy_callback_gas,
        native_denom: config.native_denom
    }, 'id');
    saveConfigBalances(configFkId[0].id, config);
};
const saveConfigBalances = async (configFkId, config) => {
    let promises = [];
    // Save available native balances
    for (const balance of config.available_balance.native) {
        promises.push((0, variables_1.db)('config_balances').insert({
            fk_config_id: (0, utils_1.bigIntMe)(configFkId),
            type: 'native',
            denom: balance.denom,
            amount: (0, utils_1.bigIntMe)(balance.amount)
        }));
    }
    // Save available cw20 balances
    for (const balance of config.available_balance.cw20) {
        promises.push((0, variables_1.db)('config_balances').insert({
            fk_config_id: (0, utils_1.bigIntMe)(configFkId),
            type: 'cw20',
            address: balance.address,
            amount: (0, utils_1.bigIntMe)(balance.amount)
        }));
    }
    // Save staked native balances
    // dude I'm so lazy
    for (const balance of config.staked_balance.native) {
        promises.push((0, variables_1.db)('config_balances').insert({
            fk_config_id: (0, utils_1.bigIntMe)(configFkId),
            type: 'native',
            denom: balance.denom,
            amount: (0, utils_1.bigIntMe)(balance.amount),
            staked: true
        }));
    }
    // lazy but readable amiright
    for (const balance of config.staked_balance.cw20) {
        promises.push((0, variables_1.db)('config_balances').insert({
            fk_config_id: (0, utils_1.bigIntMe)(configFkId),
            type: 'cw20',
            address: balance.address,
            amount: (0, utils_1.bigIntMe)(balance.amount),
            staked: true
        }));
    }
    // Do all the insertions
    await Promise.all(promises);
};
const saveTaskDetails = async () => {
    const neededBlocks = await (0, variables_1.db)('tasks').select('blocks.height', 'contract_block_piv.id')
        .rightJoin('contract_block_piv', 'contract_block_piv.id', 'tasks.fk_cb_id')
        .innerJoin('blocks', 'contract_block_piv.fk_block_id', 'blocks.id')
        .whereNull('tasks.id');
    // v('neededBlocks (tasks)', neededBlocks)
    let promises = [];
    const getTasks = {
        get_tasks: {
        // TODO: I'm totally leaving no params because I'm horrible. There is pagination to do here.
        }
    };
    for (const blockInfo of neededBlocks) {
        const blockHeight = Number.parseInt(blockInfo.height);
        const contractBlockIdFk = blockInfo.id;
        promises.push(saveTasks(variables_1.settings.contracts.manager.address, getTasks, blockHeight, contractBlockIdFk));
    }
};
exports.saveTaskDetails = saveTaskDetails;
const saveTasks = async (contractAddress, getTasks, blockHeight, contractBlockIdFk) => {
    const tasks = await (0, utils_1.queryContractAtHeight)(contractAddress, getTasks, blockHeight);
    // v('saveTasks tasks', tasks)
    let promises = [];
    for (const task of tasks) {
        promises.push(saveTask(task, contractBlockIdFk));
    }
    await Promise.all(promises);
};
const saveTask = async (task, contractBlockIdFk) => {
    let intervalType;
    // This one is a bit odd since if Block intervals would be a number, but it's fine. Don't see much number comparisons
    // being relevant for this column.
    let intervalValue = null;
    if (typeof task.interval === 'string') {
        // At the time of this writing: this means it's:
        // Immediate or Once
        intervalType = task.interval;
    }
    else {
        // Block or Cron
        intervalType = Object.keys(task.interval)[0];
        intervalValue = task.interval[intervalType].toString();
    }
    const taskFkId = await (0, variables_1.db)('tasks').insert({
        fk_cb_id: contractBlockIdFk,
        hash: task.task_hash,
        owner: task.owner_id,
        interval_type: intervalType,
        interval_value: intervalValue,
        stop_on_fail: task.stop_on_fail,
        boundary_height_start: 6,
        boundary_height_end: 19,
        boundary_time_start: new Date().toISOString(),
        boundary_time_end: new Date().toISOString(),
    });
};
const saveAgentBalances = async (agentAddress, rowId, blockInfo) => {
    const blockHeight = Number.parseInt(blockInfo.height);
    // Query the smart contract for agent details at a specific height
    const queryGetAgentReadable = {
        get_agent: {
            account_id: agentAddress // named params
        }
    };
    const contractBalances = await (0, utils_1.queryContractAtHeight)(variables_1.settings.contracts.manager.address, queryGetAgentReadable, blockHeight);
    // Add manager contract state to DB
    // 1/2 Native balances
    for (const nativeBalance of contractBalances.balance.native) {
        await (0, variables_1.db)('agent_balances').insert({
            fk_agent_id: rowId,
            type: 'manager-state',
            denom: nativeBalance.denom,
            amount: nativeBalance.amount
        });
    }
    // 2/2 cw20's (as stored in state for the contract)
    for (const contractBalance of contractBalances.balance.cw20) {
        await (0, variables_1.db)('agent_balances').insert({
            fk_agent_id: rowId,
            type: 'manager-state',
            address: contractBalance.address,
            amount: contractBalance.amount
        });
    }
    // Get token balances from protocol at a given height
    const requestProtocolData = Uint8Array.from(query_1.QueryAllBalancesRequest.encode({ address: agentAddress }).finish());
    const protocol_balances_encoded = await variables_1.tmClientQuery.queryUnverified(`/cosmos.bank.v1beta1.Query/AllBalances`, requestProtocolData, Number.parseInt(blockInfo.height));
    const protocol_balances = query_1.QueryAllBalancesResponse.decode(protocol_balances_encoded);
    // We're assuming there is no pagination :/. come fix it friend?
    for (const balance of protocol_balances.balances) {
        await (0, variables_1.db)('agent_balances').insert({
            fk_agent_id: rowId,
            type: 'protocol',
            denom: balance.denom,
            amount: balance.amount
        });
    }
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
