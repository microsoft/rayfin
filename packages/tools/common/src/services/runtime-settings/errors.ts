/**
 * Workload error vocabulary, translated to the fields a Builder edits.
 *
 * The workload still names `anonymousAccess` because that is its wire field,
 * but no Rayfin project has authored that key since the rename. Passing the
 * workload's own text through would send a Builder looking for a property that
 * `rayfin.yml` no longer has, so each known code is restated in terms of
 * `assetAccess`.
 *
 * Lives beside the outbound translation so deploy clients describe the same
 * rejection consistently.
 */
const STATIC_HOSTING_POSTURE_REQUIRED = 'StaticHostingPostureRequired';
const INVALID_STATIC_HOSTING_POSTURE = 'InvalidStaticHostingPosture';
const STATIC_HOSTING_ACCESS_POSTURE_NOT_RECORDED =
  'STATIC_HOSTING_ACCESS_POSTURE_NOT_RECORDED';

const POSTURE_REQUIRED_MESSAGE =
  "Static hosting requires an explicit access posture. Set 'services.staticHosting.assetAccess' to 'protected' to require Fabric sign-in or 'public' to serve anyone with the link, then deploy again.";
const INVALID_POSTURE_MESSAGE =
  "Invalid static hosting posture: 'services.staticHosting.embedded.only: true' cannot be combined with 'services.staticHosting.assetAccess: public' because an embedded app has no standalone surface to make public.";
const POSTURE_NOT_RECORDED_MESSAGE =
  "The static-hosting access posture has not been recorded. Run 'rayfin up' to record 'services.staticHosting.assetAccess' before trying again.";

/**
 * Keeps service error guidance aligned with the Builder-facing configuration
 * while the workload wire contract continues to use `anonymousAccess`.
 */
export function translateStaticHostingAccessError(
  details: string,
  code?: string
): string {
  if (
    code === STATIC_HOSTING_POSTURE_REQUIRED ||
    details.includes('Static hosting requires an explicit access posture')
  ) {
    return POSTURE_REQUIRED_MESSAGE;
  }

  if (
    code === INVALID_STATIC_HOSTING_POSTURE ||
    (details.includes('Invalid static hosting posture') &&
      details.includes('anonymousAccess'))
  ) {
    return INVALID_POSTURE_MESSAGE;
  }

  if (
    code === STATIC_HOSTING_ACCESS_POSTURE_NOT_RECORDED ||
    details.includes('access posture has not been recorded')
  ) {
    return POSTURE_NOT_RECORDED_MESSAGE;
  }

  return details;
}
