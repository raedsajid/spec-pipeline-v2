import { registerHooks } from "node:module";
// Node's native TypeScript transform does not resolve extensionless TS imports.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error.code === "ERR_MODULE_NOT_FOUND" &&
        specifier.startsWith(".") &&
        !/\.[a-z]+$/i.test(specifier)
      )
        return nextResolve(specifier + ".ts", context);
      throw error;
    }
  },
});
