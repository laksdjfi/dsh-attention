/**
 * dsh-attention profile bundle: minimal server entry. All functionality lives
 * in the browser client module (lib/client.js); this module only exists so the
 * bundle can be mounted into a profile layer stack via cordis.patch.yml.
 * @module dsh-attention
 */

export const name = 'dsh-attention'

export function apply(ctx, config = {}) {
  ctx.logger?.info?.('dsh-attention ready (client module handles notifications)')
}
