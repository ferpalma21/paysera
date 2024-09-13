const crypto = require('crypto');
const hostName = 'https://wallet.paysera.com/';

const paths = {
  server: {
    route:'rest/v1/server',
    method: 'GET'
  },
  configuration: {
      route: 'rest/v1/configuration',
    method: 'GET'
  },
}



let createModelPayment = function(debit_account_number, amount, beneficiary, purpose, urgency){
  if (!amount) throw new Error('No amount');
  if (typeof amount.amount !== typeof 1) throw new Error('Amount not a number');
  if (typeof amount.currency !== typeof '' || amount.currency.length !== 3 || !U.currencies[amount.currency]) throw new Error('Check currency');
  if (debit_account_number !== CONF.brickfy_debit_account_number && debit_account_number !== CONF.user_debit_account_number) throw new Error('Not a valid account Number');
  if (!beneficiary) throw new Error('No beneficiary');
  if (!beneficiary.name || typeof beneficiary.name !== typeof '') throw new Error('No beneficiary name');
  if (beneficiary.type === 'paysera' && !beneficiary.paysera_account) throw new Error('No beneficiary paysera accouunt property');
  if (beneficiary.type === 'paysera' && !beneficiary.paysera_account.email && !beneficiary.paysera_account.phone && !beneficiary.paysera_account.account_number) throw new Error('No beneficiary paysera accouunt data');
  let payment = {
    amount: {
      amount: amount.amount,
      currency: amount.currency
    },
    beneficiary: {
      type: beneficiary.type,
      name: beneficiary.name
    },
    payer: {
      account_number: debit_account_number
    },
    urgency: 'standard',
    purpose: {
      details: purpose
    }
  };
  if (beneficiary.type === 'paysera') {
    if (beneficiary.paysera_account.email && beneficiary.paysera_account.email.isEmail()) {
      payment.beneficiary.paysera_account = {
        email: beneficiary.paysera_account.email
      }
    }else if (beneficiary.paysera_account.phone) {
      payment.beneficiary.paysera_account = {
        phone: beneficiary.paysera_account.phone
      }
    }else if (beneficiary.paysera_account.account_number) {
      payment.beneficiary.paysera_account = {
        account_number: beneficiary.paysera_account.account_number
      }
    }else {
      throw new Error('No beneficiary')
    }
  }else if (beneficiary.type === 'bank') {
    payment.beneficiary.bank_account = {
      iban: beneficiary.account_number
    }
  }
//   "amount": {"amount": "100.00", "currency": "EUR"},
//   "beneficiary": {
//     "type": "paysera",
//     "name": "Name Surname",
//     "paysera_account": {
//       "email": "example@example.com"
//     }
//   },
//   "payer": {
//     "account_number": "EVP9210002477825"
//   },
//   "purpose": {
//     "details": "Transfer details that will be seen in beneficiary statement"
//   }
// }
  return payment;

}


async function checkNames(user, statement){
  let name = (`${user.fullname} ${user.surname}`).toLowerCase().split(' ');
  let transfername = statement.other_party.display_name.toLowerCase().split(' ');
  let checks = 0;
  for (var j = 0; j < name.length; j++) {
    for (var z = 0; z < transfername.length; z++) {
      if (name[j] === transfername[z]) checks++;
    }
  }
  return checks >= 2 ? true : false;
}


class PayseraWallet {
  constructor(){
    this.headers = {
      'User-Agent': `Paysera brickfy`,
      mac_id: CONF.mac_id
    }
    this.host = 'wallet.paysera.com';
    this.userAgent = `Paysera WalletApi PHP library`;
    this.mac_id = CONF.mac_id;
    this.mac_key = CONF.mac_key;
    this.hashAlg = 'sha256';
  }
  createHash(data, type) {
    if (!type) type = 'base64'
    return crypto.createHash(this.hashAlg)
     .update(data).digest(type);
  }
  createHMACHash(data, type) {
    if (!type) type = 'base64'
    return crypto.createHmac(this.hashAlg, this.mac_key)
      .update(data).digest(type);
  }
  createHMACAuth(method, path, data) {
    let bodyHash, ext;
    if (method === 'POST') {
      ext = `body_hash=${encodeURIComponent(this.createHash(JSON.stringify(data)))}`;
    }
    this.method = method;
    this.path = `/${path}`;
    let nonce = `${U.GUID(32)}`;
    let port = 443;
    let macString = `${this.ts}\n${nonce}\n${this.method}\n${this.path}\n${this.host}\n${port}\n${ext || ''}\n`;
  	let mac = this.createHMACHash(macString);
    let headerString = `MAC id="${this.mac_id}", ts="${this.ts}", nonce="${nonce}", mac="${mac}"`;
    if (method === 'POST') headerString += `, ext="${ext}"`
    return  headerString;
  }

  async getNoAuth(path){
    return new Promise((resolve, reject) => {
      const options = {
        url : `${hostName}${path.route}`,
        method: path.method,
        type: 'get',
        type: 'json'
      }
      REQUEST(options, (err, res, status, headers) => {
        resolve(JSON.parse(res));
      }, null);
    });
  }

  async getWallet(walletId, needBalance){
    return new Promise((resolve, reject) => {
      if (!walletId) throw 'No wallet ID';
      let path = {
        route: `rest/v1/wallet/${walletId}`,
      };
      this.ts = U.moment().unix();
      path.route = needBalance ? `${path.route}/balance` : path.route;
      this.headers.Authorization = `${this.createHMACAuth(path.method, path.route, this.ts)}`
      const options = {
        url: hostName + path.route,
        method: 'get',
        type: 'json',
        headers: this.headers
      }
      REQUEST(options, (err, res, status, headers) => {
        !err ? resolve(JSON.parse(res)) : reject(err);
      });
    });
  }

  async getTransfers(transferId, debit_account_number, created_date_from, created_date_to, statuses, limit, offset, order_by, order_direction, after, before){
    return new Promise((resolve, reject) => {
      if (!debit_account_number) throw new Error('No debit account number');
      if (!transferId) {
        if (created_date_to && typeof created_date_to !== typeof 1) throw new Error('Illegal type of created_date_to');
        if (created_date_from && typeof created_date_from !== typeof 1) throw new Error('Illlegal type of created_date_from');
        if (statuses && typeof statuses !== typeof '') throw new Error('Illlegal type of status');
        if (limit && typeof limit !== typeof 1) throw new Error('Illlegal type of limit');
        if (offset && typeof offset !== typeof 1) throw new Error('Illlegal type of offset');
        if (order_by && typeof order_by !== typeof '') throw new Error('Illlegal type of order_by');
        if (order_direction && (order_direction !== 'asc' && order_direction !== 'desc')) throw new Error('Illlegal type of order_direction');
        if (after && typeof after !== typeof 1) throw new Error('Illlegal type of after');
        if (before && typeof before !== typeof 1) throw new Error('Illlegal type of before');
      }
      transferId = transferId ? `/${transferId}` : '';
      let path = {
        route: `rest/v1/transfers${transferId}?debit_account_number=${debit_account_number}`,
        method: 'GET'
      };
      if (!transferId) {
        if (created_date_to) path.route += `&created_date_to=${created_date_to}`;
        if (created_date_from) path.route += `&created_date_from=${created_date_from}`;
        if (statuses) path.route += `&statuses=${statuses}`;
        if (limit) path.route += `&limit=${limit}`;
        if (offset) path.route += `&offset=${offset}`;
        path.route += `&offset=${155}`;
        if (order_by) path.route += `&order_by=${order_by}`;
        if (order_direction) path.route += `&order_direction=${order_direction}`;
        if (after) path.route += `&after=${after}`;
        if (before) path.route += `&before=${before}`;
      }
      const options = {
        url: `${hostName}${path.route}`,
        method: 'get',
        type: 'json',
        headers: this.headers
      }
      this.ts = U.moment().unix();
      this.headers.Authorization = `${this.createHMACAuth(path.method, path.route, this.ts)}`
      REQUEST(options, (err, res, status, headers) => {
        !err ? resolve(JSON.parse(res)) : reject(err);
      });
    });
  }

  async getStatements(walletId, created_date_from, created_date_to, limit, offset){
    return new Promise((resolve, reject) => {
      if (!walletId) throw new Error('No wallet Id');
      if (created_date_to && typeof created_date_to !== typeof 1) throw new Error('Illegal type of created_date_to');
      if (created_date_from && typeof created_date_from !== typeof 1) throw new Error('Illlegal type of created_date_from');
      if (limit && typeof limit !== typeof 1) throw new Error('Illlegal type of limit');
      if (offset && typeof offset !== typeof 1) throw new Error('Illlegal type of offset');
      let path = {
        route: `rest/v1/wallet/${walletId}/statements`,
        method: 'GET'
      };
      if (created_date_to) path.route += `?from=${created_date_from}`;
      if (created_date_from) path.route += `&to=${created_date_to}`;
      if (limit) path.route += `&limit=${limit}`;
      if (offset) path.route += `&offset=${offset}`;
      this.ts = U.moment().unix();
      this.headers.Authorization = `${this.createHMACAuth(path.method, path.route, this.ts)}`
      let options = {
        url: hostName + path.route,
        headesr: this.headers,
        method: path.method,
        type: 'json',
        callback: (err, res) => {
          !err ? resolve(JSON.parse(res)) : reject(err);
        }
      }
      REQUEST(options);
    });
  }

  async updateDailyDeposits(){
    return new Promise(async(resolve, reject) => {
      let daysIni = DEBUG ? 20 : 1;
      let daysEnd = DEBUG ? 0 : 1;
      let ini = U.moment().subtract(daysIni, 'days').startOf('day').unix();
      let end = U.moment().subtract(daysEnd, 'days').endOf('day').unix();
      this.getStatements(CONF.userWallet, ini, end).then(async (stmts) => {
        if (stmts.statements && stmts.statements.length > 0){
          let statements = stmts.statements;
          for (var i = 0; i < statements.length; i++) {
            if (statements[i].details && statements[i].direction == 'in' && statements[i].other_party) {
              let transactions = await DEF.mongo.asyncFind('transactions', {statement_id: '' + statements[i].id});
              if (transactions.length === 0) {
                let checkArr = statements[i].details.toLowerCase().split(' ');
                let investor_id = statements[i].details.split(' ')[0];
                if ((checkArr.indexOf('investor') >= 0 && investor_id && investor_id.length === 6)) {
                  let user = await DEF.mongo.asyncFind('users', {investor_id: investor_id});
                  if (user.length === 1 && user[0].kyc == 2) {
                    let account = await DEF.mongo.asyncFind('bank_accounts',
                        {$or: [{iban: statements[i].other_party.account_number},
                        {account_number: statements[i].other_party.account_number}], user:user[0]._id}
                      );
                    let checks = await checkNames(user[0], statements[i]);
                    if (account.length === 1 && account[0].verified && checks) {
                      let trx = {
                        user: user[0]._id,
                        amount: Number(statements[i].amount/100),
                        type: 'deposit',
                        received_date:U.moment.unix(statements[i].date).utc().valueOf(),
                        bank_account: statements[i].other_party.account_number,
                        statement_id: '' + statements[i].id,
                        transfer_id: '' + statements[i].transfer_id,
                        auto: true
                      };
                      try {
                        let x = await new Promise((reso,  reject) => {
                          $WORKFLOW('Transactions', 'add-funds-to-user', trx, (err, res) => {
                            if (!err && res.value && res.value.trx) MAIL(CONF.internal_email, TRANSLATE('en', 'Automatic Deposit'), 'mails/common', {text1: 'New automatic deposit. TRX:', text2:JSON.stringify(trx)}, NOOP);
                            reso(res);
                          });
                        });
                      } catch (e) {
                        console.error(e);
                        console.error('Adding funds user automatic');
                      }
                    }else {
                      if (checks) {
                        MAIL(CONF.internal_email, 'New bank account, requires verification and add iban manually.', 'mails/common', {text1: JSON.stringify(statements[i]), text2: JSON.stringify('Please check transaction with the data that is above')}, NOOP);
                      }else {
                        console.error('Validation required');
                        MAIL(CONF.internal_email, 'Warning, Account validation Required. Name didn\'t passed the check.', 'mails/common', {text1: JSON.stringify(statements[i]), text2: JSON.stringify('Please check transaction with the data that is above')}, NOOP);
                      }
                    }
                  }else {
                    console.error('User different than 1', user);
                    MAIL(CONF.internal_email, 'Warning, More than one user with that db.', 'mails/common', {text1: JSON.stringify(statements[i]), text2: JSON.stringify('Please check transaction with the data that is above')}, NOOP);
                  }
                }else {
                  let bank_account = await DEF.mongo.asyncFind('bank_accounts', {iban: statements[i].other_party.account_number});
                  if (bank_account.length === 1) {
                    let user = await DEF.mongo.getDBDocument('users', bank_account[0].user);
                    let checks = checkNames(user, statements[i]);
                    if (checks && user.kyc == 2) {
                      let trx = {
                        user: user._id,
                        amount: Number(statements[i].amount/100),
                        type: 'deposit',
                        received_date:U.moment.unix(statements[i].date).utc().valueOf(),
                        bank_account: statements[i].other_party.account_number,
                        statement_id: statements[i].id,
                        transfer_id: statements[i].transfer_id,
                        auto: true
                      };
                      try {
                        let x = await new Promise((reso,  reject) => {
                          $WORKFLOW('Transactions', 'add-funds-to-user', trx, (err, res) => {
                            if (!err && res.value && res.value.trx) MAIL(CONF.internal_email, TRANSLATE('en', 'Automatic Deposit'), 'mails/common', {text1: 'New automatic deposit. TRX:', text2:JSON.stringify(trx)}, NOOP);
                            reso(res);
                          });
                        });
                      } catch (e) {
                        console.error(e);
                        console.error('Adding funds user automatic');
                      }
                    }else {
                      MAIL(CONF.internal_email, 'User didn\'t pass the checknames; No affiliate id on transaction; No user founded with that # account, need manual update', 'mails/common', {text1: JSON.stringify(statements[i]), text2: JSON.stringify('Please check transaction with the data that is above')}, NOOP);
                    }
                  }else {
                    MAIL(CONF.internal_email, 'No affiliate id on transaction and no user founded with that # account, need manual update', 'mails/common', {text1: JSON.stringify(statements[i]), text2: JSON.stringify('Please check transaction with the data that is above')}, NOOP);
                  }
                }
              }else {
                if (DEBUG) console.log('Transaction already added');
              }
            }else {
              if (DEBUG) console.log('No in transaction');
            }
          }
          resolve(stmts);
        }else {
          resolve(stmts);
        }
      });
    });
  }

  async createTransfer(debit_account_number, type, amount, beneficiary, purpose, urgency, typeOfStep){
    return new Promise(async (resolve, reject) => {
      if (type !== 'bank' && type !== 'paysera') {
        reject('No Type');
        return;
      }else {
        beneficiary.type = type;
        let payment = createModelPayment(debit_account_number, amount, beneficiary, purpose, urgency);
        let path = {
          route: `rest/v1/transfers`,
          method: 'POST'
        };
        this.ts = U.moment().unix();
        this.headers.Authorization = `${this.createHMACAuth(path.method, path.route, payment)}`;
        if (!DEBUG) {
          const options = {
            url: `${hostName}${path.route}`,
            method: 'post',
            headers: this.headers,
            type: 'json',
            body: payment,
            callback: (err, res) => {
              const new_trx = JSON.parse(res);
              if (new_trx.id && typeOfStep && typeOfStep!== ''){
                this.secondStepTransfer(new_trx.id, typeOfStep).then((res2) => {
                  !err && res ? resolve(res2) : reject(err);
                });
              }else {
                !err && res ? resolve(new_trx) : reject(err);
              }
            }
          }
          REQUEST(options)
        }else {
          resolve({ok:true});
        }
      }
    });
  }

  async secondStepTransfer(id, typeOfStep){
    const allowedTypesOfSteps = ['sign', 'register'];
    return new Promise(async (resolve, reject) => {
      if (allowedTypesOfSteps.indexOf(typeOfStep) < 0){
        reject('Error, type not allowed');
        return;
      }else {
        let path = {
          route: `rest/v1/transfers/${id}/${typeOfStep}`,
          method: `PUT`
        };
        this.ts = U.moment().unix();

        const options = {
          headers: {
            Authorization: `${this.createHMACAuth(path.method, path.route)}`
          },
          url: hostName + path.route,
          method: 'PUT',
          type: 'json',
          callback: (err, res) => {
            !err && res ? resolve(JSON.parse(res)) : reject(err);
          }
        }
        REQUEST(options);
      }
    });
  }
}

module.exports = PayseraWallet;
