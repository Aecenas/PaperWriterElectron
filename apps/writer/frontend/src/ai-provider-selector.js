export function groupTestedAiProviders(providers = [], builtinOptions = []) {
  return Array.from(providers.reduce((groups, model) => {
    const existing = groups.get(model.provider);
    if (existing) {
      existing.models.push(model);
      return groups;
    }
    const builtin = builtinOptions.find((option) => option.id === model.provider);
    groups.set(model.provider, {
      id: model.provider,
      label: model.providerLabel || builtin?.label || model.provider,
      protocol: model.protocol || builtin?.protocol || "openai",
      transport: model.transport || builtin?.transport || "http",
      builtin: Boolean(model.builtin || builtin?.builtin),
      models: [model],
    });
    return groups;
  }, new Map()).values());
}
