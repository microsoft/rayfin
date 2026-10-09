export const tsSdkRouteBasePath = 'docs/ts-sdk';

export function getSiteSettings(env: Record<string, string | undefined>) {
  const isPublicSite =
    env.DOCUSAURUS_PUBLIC_SITE === 'true' ||
    (env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_REPOSITORY === 'microsoft/rayfin');
  const repositoryName = isPublicSite ? 'rayfin' : 'project-rayfin';
  const githubUrl = `https://github.com/microsoft/${repositoryName}`;
  const baseUrl = isPublicSite ? '/rayfin/' : '/';

  return {
    url: isPublicSite
      ? 'https://microsoft.github.io'
      : 'https://cautious-chainsaw-l1y4rgq.pages.github.io/',
    baseUrl,
    organizationName: 'Microsoft',
    projectName: isPublicSite ? 'rayfin' : 'Project Rayfin',
    githubUrl,
    tsSdkActiveBaseRegex: `^${baseUrl}${tsSdkRouteBasePath}(?:/|$)`,
    editUrl: (repositoryPath: string, docPath: string) =>
      `${githubUrl}/tree/main/${repositoryPath}/${docPath}`,
  };
}

export function getSdkEditUrl(
  settings: ReturnType<typeof getSiteSettings>,
  docPath: string,
  repositoryPathByModule: ReadonlyMap<string, string>,
  typedocBackedModules: ReadonlySet<string>
) {
  const [module, ...rest] = docPath.split('/');
  // Generated markdown has no editable counterpart in the source tree.
  if (typedocBackedModules.has(module)) {
    return undefined;
  }
  const repositoryPath = repositoryPathByModule.get(module);
  if (!repositoryPath) {
    return undefined;
  }
  return settings.editUrl(repositoryPath, rest.join('/'));
}
