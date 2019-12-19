import { Callback, Embark, EmbarkConfig, EmbarkEvents } from "embark-core";
import { Events } from "embark-core";
import { Logger } from 'embark-logger';
import { AccountParser, dappPath } from "embark-utils";
import Web3 from "web3";
import EthAccounts from "./eth_accounts";
import EthSendTransaction from "./eth_sendTransaction";
import EthSignData from "./eth_signData";
import EthSignTypedData from "./eth_signTypedData";
import EthSubscribe from "./eth_subscribe";
import EthUnsubscribe from "./eth_unsubscribe";
import PersonalNewAccount from "./personal_newAccount";
import RpcModifier from "./rpcModifier";
import constants from "embark-core/constants.json";

export default class RpcManager {

  private modifiers: RpcModifier[] = [];
  private _web3: Web3 | null = null;
  private rpcModifierEvents: EmbarkEvents;
  private logger: Logger;
  private events: EmbarkEvents;
  public _accounts: any[] | null = null;
  public _nodeAccounts: any[] | null = null;
  private blockchainConfig: EmbarkConfig["blockchainConfig"];
  constructor(private readonly embark: Embark) {
    this.events = embark.events;
    this.logger = embark.logger;
    this.rpcModifierEvents = new Events() as EmbarkEvents;
    this.blockchainConfig = this.embark.config.blockchainConfig;
    this.init();
  }

  protected get web3() {
    return (async () => {
      if (!this._web3) {
        let provider;
        let testsCliOptions;
        let isTest = false;

        await this.events.request2("blockchain:started");

        if (this.embark.currentContext.includes(constants.contexts.test)) {
          isTest = true;
          testsCliOptions = await this.events.request2("tests:cli:options");
        }
        if (isTest && testsCliOptions.node === constants.blockchain.vm) {
          provider = await this.events.request2("blockchain:client:vmProvider");
        } else {
          let endpoint = this.blockchainConfig.endpoint;
          if (isTest && testsCliOptions.node) {
            endpoint = testsCliOptions.node;
          }
          provider = await this.events.request2("blockchain:client:provider", "ethereum", endpoint);
        }
        this._web3 = new Web3(provider);
      }
      return this._web3;
    })();
  }

  private get nodeAccounts() {
    return (async () => {
      if (!this._nodeAccounts) {
        const web3 = await this.web3;
        this._nodeAccounts = await web3.eth.getAccounts();
      }
      return this._nodeAccounts || [];
    })();
  }

  private get accounts() {
    return (async () => {
      if (!this._accounts) {
        const web3 = await this.web3;
        const nodeAccounts = await this.nodeAccounts;
        this._accounts = AccountParser.parseAccountsConfig(this.embark.config.blockchainConfig.accounts, web3, dappPath(), this.logger, nodeAccounts);
      }
      return this._accounts || [];
    })();
  }

  private async init() {

    this.embark.registerActionForEvent("tests:config:updated", { priority: 40 }, (_params, cb) => {
      // web.eth.getAccounts may return a different value now
      // update accounts across all modifiers
      this.updateAccounts(cb);
    });

    this.rpcModifierEvents.setCommandHandler("nodeAccounts:updated", this.updateAccounts.bind(this));

    const web3 = await this.web3;
    const nodeAccounts = await this.nodeAccounts;
    const accounts = await this.accounts;

    this.modifiers = [
      PersonalNewAccount,
      EthAccounts,
      EthSendTransaction,
      EthSignTypedData,
      EthSignData,
      EthSubscribe,
      EthUnsubscribe
    ].map((RpcMod) => new RpcMod(this.embark, this.rpcModifierEvents, nodeAccounts, accounts, web3));
  }

  private async updateAccounts(cb: Callback<null>) {
    this._nodeAccounts = null;
    this._accounts = null;
    for (const modifier of this.modifiers) {
      modifier.nodeAccounts = await this.nodeAccounts;
      modifier.accounts = await this.accounts;
    }
    cb();
  }
}
