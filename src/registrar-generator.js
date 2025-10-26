/**
 * Shared base class for registrar price list generators.
 * The goal is to keep generator implementations small and
 * platform-neutral so that they can run in Node or the browser.
 */

/**
 * @typedef {Object} GeneratorContext
 * @property {Record<string, string>} [env]
 *   Arbitrary environment configuration such as API keys. Implementations
 *   should prefer explicit options but may fall back to these values.
 * @property {Record<string, any>} [options]
 *   Free-form configuration specific to the generator.
 * @property {(entry: { level?: 'info'|'warn'|'error', message: string }) => void} [logger]
 *   Optional logger used for verbose information. Defaults to a noop logger.
 * @property {AbortSignal} [signal]
 *   Optional abort signal that can be used to cancel long running requests.
 */

/**
 * @template TResult
 * @typedef {(context: GeneratorContext) => Promise<TResult>} GeneratorHandler
 */

export class RegistrarPriceGenerator {
  /**
   * @param {Object} config
   * @param {string} config.id
   * @param {string} config.label
   * @param {string} [config.description]
   * @param {string} [config.defaultOutput]
   * @param {GeneratorHandler<any>} config.generate
   */
  constructor({ id, label, description = '', defaultOutput, generate }) {
    if (!id) throw new TypeError('RegistrarPriceGenerator requires an "id".');
    if (!label) throw new TypeError('RegistrarPriceGenerator requires a "label".');
    if (typeof generate !== 'function') {
      throw new TypeError('RegistrarPriceGenerator requires a generate() function.');
    }
    this.id = id;
    this.label = label;
    this.description = description;
    this.defaultOutput = defaultOutput || `${id}-prices.json`;
    this._generate = generate;
  }

  /**
   * Execute the generator and return the structured price list.
   *
   * @param {GeneratorContext} [context]
   * @returns {Promise<any>}
   */
  async generate(context = {}) {
    const logger = context.logger || (() => {});
    return this._generate({ ...context, logger });
  }
}

/**
 * Convenience helper to create a generator without the `new` keyword.
 * @param {ConstructorParameters<typeof RegistrarPriceGenerator>[0]} config
 */
export function createRegistrarPriceGenerator(config) {
  return new RegistrarPriceGenerator(config);
}

