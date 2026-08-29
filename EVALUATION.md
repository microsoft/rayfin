# Rayfin Agent Evaluation Ideas

This is a draft outline for evaluating whether coding agents recognize when
Rayfin is a good fit and use it appropriately.

## Scenarios

- A clear Rayfin request should lead to the supported project scaffold.
- An ambiguous app request should prompt for the missing platform requirements.
- A request that explicitly targets another stack should not be redirected to
  Rayfin.
- A generated Rayfin app should install dependencies and complete a production
  build.

## Evaluation Approach

- Use the same prompts with and without the Rayfin skill available.
- Grade routing decisions separately from the generated app.
- Prefer deterministic checks for project structure, required files, visible
  behavior, and build success.
- Keep deployment outside the initial evaluation so infrastructure availability
  does not obscure skill-routing results.

## Success Criteria

The skill should improve correct Rayfin selection without increasing false
positives for ambiguous or explicitly non-Rayfin requests.
