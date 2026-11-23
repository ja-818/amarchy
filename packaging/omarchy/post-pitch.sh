#!/bin/bash
# Post the pitch (pitch.md) to Omarchy as a discussion in Suggestions, where
# Omarchy takes ideas (its issues are for verified bugs). As you, with gh.
#
#   packaging/omarchy/post-pitch.sh            prints its address once posted
#   packaging/omarchy/post-pitch.sh --dry-run  says where it would go, posts nothing

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
title="amarchy: run a dozen Claude Code agents from Omarchy, and from your phone"

ids=$(gh api graphql -f query='query { repository(owner: "omacom", name: "omarchy") { id discussionCategories(first: 25) { nodes { id slug } } } }' \
  --jq '.data.repository.id + " " + (.data.repository.discussionCategories.nodes[] | select(.slug == "suggestions") | .id)')
repo_id=${ids%% *}
category_id=${ids##* }
[[ -n $repo_id && -n $category_id && $repo_id != "$category_id" ]] || { echo "Omarchy's Suggestions category wasn't found" >&2; exit 1; }

if [[ ${1:-} == --dry-run ]]; then
  echo "Would post \"$title\" to omacom/omarchy, Suggestions ($category_id), $(wc -w <"$here/pitch.md") words."
  exit 0
fi

gh api graphql \
  -f query='mutation($repo: ID!, $category: ID!, $title: String!, $body: String!) {
    createDiscussion(input: {repositoryId: $repo, categoryId: $category, title: $title, body: $body}) { discussion { url } } }' \
  -f repo="$repo_id" -f category="$category_id" -f title="$title" -f body="$(cat "$here/pitch.md")" \
  --jq '.data.createDiscussion.discussion.url'
