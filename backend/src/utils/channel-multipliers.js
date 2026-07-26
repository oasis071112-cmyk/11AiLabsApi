function positiveMultiplier(value) {
  const multiplier = Number(value);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

function resolveChannelMultipliers(channel = {}, fallback = {}) {
  return {
    input: positiveMultiplier(channel?.billing_multiplier_input)
      ?? positiveMultiplier(fallback.input)
      ?? 1,
    output: positiveMultiplier(channel?.billing_multiplier_output)
      ?? positiveMultiplier(fallback.output)
      ?? 1,
    image: positiveMultiplier(channel?.billing_multiplier_image)
      ?? positiveMultiplier(fallback.image)
      ?? 1,
  };
}

module.exports = { positiveMultiplier, resolveChannelMultipliers };
