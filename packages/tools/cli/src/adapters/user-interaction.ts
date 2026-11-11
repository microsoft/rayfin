/**
 * CLI implementation of the {@link UserInteraction} adapter.
 *
 * Backs mid-flow prompts with inquirer. Most workflows take every input on
 * their `Request` and never declare this dependency — pre-flight collection
 * happens in Layer 1 prompt helpers. This impl exists for the rare workflow
 * that genuinely needs input discovered partway.
 *
 * Dismissal semantics follow the interface: inquirer resolves the answer
 * synchronously on submit and has no first-class "dismissed" signal for a
 * non-interactive stream, so `prompt` / `select` return the entered/chosen
 * value here; the `undefined` branch exists for hosts whose pickers can be
 * escaped. `confirm` always resolves a boolean.
 */
import type {
  SelectChoice,
  SelectOptions,
  UserInteraction,
} from '@microsoft/rayfin-tools-common/_internal/adapters';
import inquirer from 'inquirer';

/** inquirer-backed {@link UserInteraction} implementation for the CLI host. */
export const cliUserInteraction: UserInteraction = {
  async prompt(
    message: string,
    options?: { default?: string }
  ): Promise<string | undefined> {
    const { value } = await inquirer.prompt<{ value: string }>([
      {
        type: 'input',
        name: 'value',
        message,
        default: options?.default,
      },
    ]);
    return value;
  },

  async confirm(
    message: string,
    options?: { default?: boolean }
  ): Promise<boolean> {
    const { value } = await inquirer.prompt<{ value: boolean }>([
      {
        type: 'confirm',
        name: 'value',
        message,
        default: options?.default ?? false,
      },
    ]);
    return value;
  },

  async select<T>(
    message: string,
    choices: SelectChoice<T>[],
    options?: SelectOptions
  ): Promise<T | undefined> {
    const { value } = await inquirer.prompt<{ value: T }>([
      {
        // `rawlist` numbers the choices and highlights none, so the answer has
        // to be typed; `list` would let Enter accept the first one.
        type: options?.requireExplicitChoice ? 'rawlist' : 'list',
        name: 'value',
        message,
        choices: choices.map((choice) => ({
          name: choice.description
            ? `${choice.label} — ${choice.description}`
            : choice.label,
          value: choice.value,
        })),
      },
    ]);
    return value;
  },
};
