/** A Signer adapter answered something the contract does not allow; a bug, never client input (500). */
export class SignerContractException extends Error {
  constructor(message: string) {
    super(`Signer contract violated: ${message}`);
    this.name = 'SignerContractException';
  }
}
