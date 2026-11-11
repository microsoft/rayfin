/** A single choice offered by {@link UserInteraction.select}. */
export interface SelectChoice<T> {
  /** Label shown to the user. */
  label: string;
  /** Value returned when this choice is picked. */
  value: T;
  /** Optional secondary text shown alongside the label. */
  description?: string;
}

/**
 * UserInteraction adapter — mid-flow prompts.
 *
 * Optional in a workflow's `Deps`. Most workflows take every input on their
 * `Request` and stay non-interactive — pre-flight collection happens in
 * Layer 1 (`cli/src/commands/<name>/prompts.ts`), not here. Only workflows
 * that genuinely need input discovered partway (e.g. a confirmation gate)
 * declare this dependency.
 *
 * A non-interactive host constructs its container without a
 * `UserInteraction`; any workflow that names it then fails to wire on that
 * host at compile time — surfacing the incompatibility early rather than at
 * runtime.
 */
export interface UserInteraction {
  /**
   * Free-text prompt. Resolves to the entered string, or `undefined` when
   * the user dismisses the prompt (e.g. by pressing Esc).
   * Dismissal is an expected outcome, not an error — the workflow decides
   * whether to default, skip, or treat it as a cancellation.
   */
  prompt(
    message: string,
    options?: { default?: string }
  ): Promise<string | undefined>;

  /**
   * Yes/no confirmation. Resolves to the user's choice; a dismissal maps to
   * `false` (or the provided `default`), so this never resolves `undefined`.
   */
  confirm(message: string, options?: { default?: boolean }): Promise<boolean>;

  /**
   * Single-choice picker. Resolves to the chosen value, or `undefined` when
   * the user dismisses the picker (e.g. by pressing Esc).
   */
  select<T>(
    message: string,
    choices: SelectChoice<T>[],
    options?: SelectOptions
  ): Promise<T | undefined>;
}

/** Behavioral options for {@link UserInteraction.select}. */
export interface SelectOptions {
  /**
   * Forbid any option from being pre-selected, so accepting the prompt without
   * choosing is impossible. For a question where every answer is consequential
   * and none is safe to assume — pickers normally highlight the first choice,
   * which lets it be accepted by pressing Enter.
   */
  requireExplicitChoice?: boolean;
}
