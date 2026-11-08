// NEAR JSON-RPC `send_tx` responses for the wallet's broadcast path.

export const OWNER_ACCOUNT_ID = '10d3ca37673ba83270a2ddd5baba1966ed14a7eb93cbf4d8134a117e7e4a25f5';
export const FAILED_TRANSACTION_HASH = '3FUntsAnjo7YtZmLU1429k4FKUAATE4UZZYnPtfKdBRz';
const VAULT_CONTRACT = 'seams-wallet.testnet';

const contractPanic = {
  ActionError: {
    index: 0,
    kind: {
      FunctionCallError: {
        ExecutionError: 'Smart contract panicked: account is not speakable',
      },
    },
  },
};

/**
 * Testnet transaction 3FUntsAnjo7YtZmLU1429k4FKUAATE4UZZYnPtfKdBRz (`create_vault`, 0.15 NEAR),
 * read with RPC `tx` at FINAL on 2026-11-09. The gas profiles and refund receipts are removed.
 */
function executedOutcome(status: Record<string, unknown>) {
  return {
    final_execution_status: 'FINAL',
    status,
    transaction: {
      actions: [
        {
          FunctionCall: {
            args: 'e30=',
            deposit: '150000000000000000000000',
            gas: 30000000000000,
            method_name: 'create_vault',
          },
        },
      ],
      hash: FAILED_TRANSACTION_HASH,
      nonce: 276792631000001,
      priority_fee: 0,
      public_key: 'ed25519:28gqDGQfBbBuvKmtzA9L9pd1fEPehikomAhT38mi8KLx',
      receiver_id: VAULT_CONTRACT,
      signature:
        'ed25519:2ZboAmbqkUiBYEpYcnha1XtfR3FmQ7ejB3KgqnDrtFHUbFBAxEvDKuGUR2XBoPmU6MkLX97R6kRJm8d2w8VygMZZ',
      signer_id: OWNER_ACCOUNT_ID,
    },
    transaction_outcome: {
      block_hash: '2az9WE1LP7jf6juJMVqJoye8JVBjjpbGES3D9cUpR9QB',
      id: FAILED_TRANSACTION_HASH,
      outcome: {
        executor_id: OWNER_ACCOUNT_ID,
        gas_burnt: 308727072010,
        logs: [],
        metadata: { gas_profile: null, version: 1 },
        receipt_ids: ['2yN6M8ZLe7xBhJUZMzgQpfX5aX5ERrSmHf4jmD2yRyxT'],
        status: { SuccessReceiptId: '2yN6M8ZLe7xBhJUZMzgQpfX5aX5ERrSmHf4jmD2yRyxT' },
        tokens_burnt: '30872707201000000000',
      },
      proof: [],
    },
    receipts_outcome: [
      {
        block_hash: 'CiDaXZv1BfAUkknuxzLd8hEQvquPzRXdF7T69KP4BSKQ',
        id: '2yN6M8ZLe7xBhJUZMzgQpfX5aX5ERrSmHf4jmD2yRyxT',
        outcome: {
          executor_id: VAULT_CONTRACT,
          gas_burnt: 1278583251504,
          logs: [],
          metadata: { gas_profile: [], version: 4 },
          receipt_ids: [],
          status,
          tokens_burnt: '127858325150400000000',
        },
        proof: [{ direction: 'Left', hash: 'tiMLxC1FqqQ3XK9cb9sWbuW25N4eaY8vmtf8EdwLxF1' }],
      },
    ],
  };
}

/** The final Failure that testnet returned for the transaction. */
export const contractPanicResponse = {
  jsonrpc: '2.0',
  id: 'near-rpc',
  result: executedOutcome({ Failure: contractPanic }),
};

/** The same transaction with a successful final status. */
export const successResponse = {
  jsonrpc: '2.0',
  id: 'near-rpc',
  result: executedOutcome({ SuccessValue: '' }),
};

/** NEAR refuses a transaction that the signer cannot pay for, before it runs. */
export const notEnoughBalanceResponse = {
  jsonrpc: '2.0',
  id: 'near-rpc',
  error: {
    name: 'HANDLER_ERROR',
    cause: {
      name: 'INVALID_TRANSACTION',
      info: {
        TxExecutionError: {
          InvalidTxError: {
            NotEnoughBalance: {
              signer_id: OWNER_ACCOUNT_ID,
              balance: '10000000000000000000000',
              cost: '150318000000000000000000',
            },
          },
        },
      },
    },
    code: -32000,
    message: 'Server error',
    data: {
      TxExecutionError: {
        InvalidTxError: {
          NotEnoughBalance: {
            signer_id: OWNER_ACCOUNT_ID,
            balance: '10000000000000000000000',
            cost: '150318000000000000000000',
          },
        },
      },
    },
  },
};

/** The node waited for the outcome and gave up. The transaction may still run. */
export const timeoutResponse = {
  jsonrpc: '2.0',
  id: 'near-rpc',
  error: {
    name: 'HANDLER_ERROR',
    cause: { name: 'TIMEOUT_ERROR', info: {} },
    code: -32000,
    message: 'Server error',
    data: 'Timeout',
  },
};
