#!/usr/bin/env bash
# Puts amarchy-relay on Google Cloud Run's free tier, built from this
# checkout. Run it with gcloud signed in (gcloud auth login):
#
#   relay/deploy/cloudrun/deploy.sh <project-id> [region]
#
# Run it again any time: it only changes what's different. It never changes
# the relay's secret on its own (the endpoints phones hold open with it);
# ROTATE_SECRET=1 makes a new one and keeps the old one opening them.
#
# From the environment, all optional:
#   APNS_KEY_FILE   the .p8 key from Apple (developer.apple.com > Keys, with APNs on)
#   APNS_KEY_ID     its 10-character id               (needed with APNS_KEY_FILE)
#   APNS_TEAM_ID    your Apple developer team id      (needed with APNS_KEY_FILE)
#   APNS_TOPICS     the iPhone app's bundle id        (io.github.ja818.amarchy)
#   FCM_PROJECT     the Firebase project              (this project); FCM=off for none
#   FCM_APPS        the Android app's package name    (io.github.ja818.amarchy)
#   RELAY_URL       a domain of yours mapped to it    (Cloud Run's own address, else;
#                   a new one keeps the old working: RELAY_OLD_URLS)
#   RELAY_SECRET    its secret, on the first run      (else one is made)
#   ROTATE_SECRET   1: a new secret, the old one still opens what it made
#   SERVICE         the service's name                (amarchy-relay)
set -euo pipefail

say() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf '\namarchy-relay deploy: %s\n' "$*" >&2; exit 1; }

PROJECT=${1:-}
REGION=${2:-${REGION:-us-central1}}
[ -n "$PROJECT" ] || die "usage: $0 <project-id> [region]   (region: us-central1 when not given)"
SERVICE=${SERVICE:-amarchy-relay}
APP_ID=io.github.ja818.amarchy
RELAY=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RUN_SA="$SERVICE@$PROJECT.iam.gserviceaccount.com"
SECRET_NAME="$SERVICE-secret"
OLD_SECRETS_NAME="$SERVICE-old-secrets"
APNS_SECRET_NAME="$SERVICE-apns-key"
FCM=${FCM:-on}

g() { gcloud --project "$PROJECT" --quiet "$@"; }

# IAM takes a little while to know an account just made: try again.
retry() {
  local i
  for i in 1 2 3 4 5 6; do
    if "$@"; then return 0; fi
    [ "$i" = 6 ] || { note "not yet, trying again in 10 s"; sleep 10; }
  done
  return 1
}

# amarchy-relay itself, from this checkout (the code being deployed).
relay() {
  if command -v go >/dev/null; then
    (cd "$RELAY" && go run ./cmd/amarchy-relay "$@")
  elif command -v amarchy-relay >/dev/null; then
    amarchy-relay "$@"
  else
    die "needs Go (https://go.dev/dl) to run amarchy-relay from this checkout, or amarchy-relay on your PATH"
  fi
}

hash() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }

secret_exists() { g secrets describe "$1" >/dev/null 2>&1; }
secret_value() { g secrets versions access latest --secret "$1"; }

# put_secret <name> <file>: makes the secret, or adds a version when the
# file says something else than its latest.
put_secret() {
  if ! secret_exists "$1"; then
    g secrets create "$1" --replication-policy automatic --data-file "$2" >/dev/null
    note "made $1"
  elif [ "$(secret_value "$1" | hash)" != "$(hash <"$2")" ]; then
    g secrets versions add "$1" --data-file "$2" >/dev/null
    note "$1 has a new version"
  else
    note "$1 is the same: kept"
  fi
}

# current_env <name>: what the service runs with now, when it's there
# (nothing the first time: describe fails, and that's not an error here).
current_env() {
  { g run services describe "$SERVICE" --region "$REGION" --format 'yaml(spec.template.spec.containers[0].env)' 2>/dev/null || true; } |
    awk -v name="$1" '$0 ~ "name: " name "$" { getline; sub(/^[ -]*value: */, ""); gsub(/["\047]/, ""); print; exit }'
}

tmp=$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/amarchy-relay-deploy.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

# ---- before anything in the cloud ----

say "Checking what's needed here"
command -v gcloud >/dev/null || die "needs gcloud: https://cloud.google.com/sdk/docs/install"
command -v curl >/dev/null || die "needs curl"
ACCOUNT=$({ gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true; } | head -n1)
[ -n "$ACCOUNT" ] || die "gcloud isn't signed in: run gcloud auth login, then this again"
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null) ||
  die "can't see project $PROJECT as $ACCOUNT: is the id right? (gcloud projects list)"
note "as $ACCOUNT, project $PROJECT ($NUMBER), region $REGION"

if [ -n "${APNS_KEY_FILE:-}" ]; then
  [ -r "$APNS_KEY_FILE" ] || die "can't read APNS_KEY_FILE ($APNS_KEY_FILE)"
  # Absolute: amarchy-relay check runs from relay/.
  APNS_KEY_FILE="$(cd "$(dirname "$APNS_KEY_FILE")" && pwd)/$(basename "$APNS_KEY_FILE")"
  [ -n "${APNS_KEY_ID:-}" ] && [ -n "${APNS_TEAM_ID:-}" ] ||
    die "APNS_KEY_FILE needs APNS_KEY_ID (the key's id) and APNS_TEAM_ID (your team's id) with it"
  APNS_TOPICS=${APNS_TOPICS:-$APP_ID}
fi
if [ "$FCM" != off ]; then
  FCM_PROJECT=${FCM_PROJECT:-$PROJECT}
  FCM_APPS=${FCM_APPS:-$APP_ID}
fi

say "Checking the configuration with amarchy-relay check"
(
  # Only what the service gets: nothing else this shell has set.
  unset RELAY_SECRETS RELAY_LISTEN RELAY_CLIENT_IP_HEADER APNS_KEY APNS_URL APNS_SANDBOX_URL \
    FCM_CREDENTIALS FCM_URL FCM_TOKEN_URL FCM_METADATA_URL
  export RELAY_URL="https://$SERVICE-$NUMBER.$REGION.run.app" RELAY_TRUST_PROXY=1
  RELAY_SECRET=$(relay secret)
  export RELAY_SECRET
  if [ -n "${APNS_KEY_FILE:-}" ]; then
    export APNS_KEY_FILE APNS_KEY_ID APNS_TEAM_ID APNS_TOPICS
  else
    unset APNS_KEY_FILE APNS_KEY_ID APNS_TEAM_ID APNS_TOPICS
  fi
  if [ "$FCM" != off ]; then
    export FCM_PROJECT FCM_APPS
  else
    unset FCM_PROJECT FCM_APPS
  fi
  relay check | sed 's/^/    /'
) || die "fix what check says, then run this again"
[ -n "${APNS_KEY_FILE:-}" ] || note "(no APNS_KEY_FILE: APNs stays as it is on the service, or off)"

# ---- Google Cloud ----

fcm_api=""
[ "$FCM" = off ] || fcm_api=", FCM"
say "Turning on the APIs it uses: Cloud Run, Cloud Build, Artifact Registry, Secret Manager, IAM, Compute (Cloud Build's account)$fcm_api"
apis=(run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
  iam.googleapis.com compute.googleapis.com)
if [ "$FCM" != off ] && [ "$FCM_PROJECT" = "$PROJECT" ]; then
  apis+=(fcm.googleapis.com)
fi
g services enable "${apis[@]}"
if [ "$FCM" != off ] && [ "$FCM_PROJECT" != "$PROJECT" ]; then
  gcloud --project "$FCM_PROJECT" --quiet services enable fcm.googleapis.com
fi

say "Making the service's own account, $RUN_SA: it reads the relay's secrets and sends with FCM, nothing else"
if g iam service-accounts describe "$RUN_SA" >/dev/null 2>&1; then
  note "it's there already"
else
  g iam service-accounts create "$SERVICE" --display-name "amarchy-relay (Cloud Run)" >/dev/null
  note "made it"
fi

BUILD_SA="$NUMBER-compute@developer.gserviceaccount.com"
say "Letting Cloud Build ($BUILD_SA) build the image and store it (Cloud Run Builder)"
for _ in $(seq 1 24); do
  g iam service-accounts describe "$BUILD_SA" >/dev/null 2>&1 && break
  sleep 5
done
retry g projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$BUILD_SA" \
  --role roles/run.builder --condition None >/dev/null

say "Keeping the relay's secret in Secret Manager ($SECRET_NAME)"
if ! secret_exists "$SECRET_NAME"; then
  value=${RELAY_SECRET:-$(relay secret)}
  [ "${#value}" -ge 32 ] || die "RELAY_SECRET must be 32 characters or more (amarchy-relay secret makes one)"
  printf %s "$value" >"$tmp/secret"
  put_secret "$SECRET_NAME" "$tmp/secret"
elif [ "${ROTATE_SECRET:-}" = 1 ]; then
  note "rotating: a new secret makes endpoints, the old one still opens the ones phones hold"
  old=$(secret_value "$SECRET_NAME")
  olds=""
  if secret_exists "$OLD_SECRETS_NAME"; then olds=$(secret_value "$OLD_SECRETS_NAME"); fi
  printf %s "${olds:+$olds,}$old" >"$tmp/old"
  put_secret "$OLD_SECRETS_NAME" "$tmp/old"
  relay secret | tr -d '\n' >"$tmp/secret"
  put_secret "$SECRET_NAME" "$tmp/secret"
else
  note "it's there already: kept (ROTATE_SECRET=1 makes a new one)"
  [ -z "${RELAY_SECRET:-}" ] || note "RELAY_SECRET left alone: the service keeps the one it has"
fi

if [ -n "${APNS_KEY_FILE:-}" ]; then
  say "Keeping the APNs key in Secret Manager ($APNS_SECRET_NAME)"
  put_secret "$APNS_SECRET_NAME" "$APNS_KEY_FILE"
fi

say "Letting the service read its secrets, and only those"
for s in "$SECRET_NAME" "$OLD_SECRETS_NAME" "$APNS_SECRET_NAME"; do
  secret_exists "$s" || continue
  retry g secrets add-iam-policy-binding "$s" --member "serviceAccount:$RUN_SA" \
    --role roles/secretmanager.secretAccessor --condition None >/dev/null
  note "$s"
done

if [ "$FCM" != off ]; then
  say "Letting the service send with FCM in $FCM_PROJECT (Firebase Cloud Messaging Admin): no key file needed"
  retry gcloud --project "$FCM_PROJECT" --quiet projects add-iam-policy-binding "$FCM_PROJECT" \
    --member "serviceAccount:$RUN_SA" --role roles/firebasecloudmessaging.admin --condition None >/dev/null
fi

# Its address: the one it has (phones hold endpoints that start with it),
# a domain you gave, or Cloud Run's own, known before the first deploy.
NOW_URL=$(current_env RELAY_URL)
OLD_URLS=$(current_env RELAY_OLD_URLS)
URL=${RELAY_URL:-$NOW_URL}
URL=${URL%/}
FIRST=""
if [ -z "$URL" ]; then
  URL="https://$SERVICE-$NUMBER.$REGION.run.app"
  FIRST=1
elif [ -n "$NOW_URL" ] && [ "$URL" != "$NOW_URL" ] && [[ ",$OLD_URLS," != *",$NOW_URL,"* ]]; then
  say "Moving it from $NOW_URL to $URL: the endpoints phones hold at the old address keep working (RELAY_OLD_URLS)"
  OLD_URLS="${OLD_URLS:+$OLD_URLS,}$NOW_URL"
fi

say "Building it from $RELAY and deploying it at $URL: at most one instance (its limits live in its memory), none while idle"
envs="RELAY_TRUST_PROXY=1|RELAY_URL=$URL"
if [ -n "$OLD_URLS" ]; then envs+="|RELAY_OLD_URLS=$OLD_URLS"; fi
if [ -n "${APNS_KEY_FILE:-}" ]; then
  envs+="|APNS_KEY_ID=$APNS_KEY_ID|APNS_TEAM_ID=$APNS_TEAM_ID|APNS_TOPICS=$APNS_TOPICS"
fi
remove=()
if [ "$FCM" != off ]; then
  envs+="|FCM_PROJECT=$FCM_PROJECT|FCM_APPS=$FCM_APPS"
else
  remove=(--remove-env-vars FCM_PROJECT,FCM_APPS)
fi
secrets="RELAY_SECRET=$SECRET_NAME:latest"
if secret_exists "$OLD_SECRETS_NAME"; then secrets+=",RELAY_SECRETS=$OLD_SECRETS_NAME:latest"; fi
if secret_exists "$APNS_SECRET_NAME"; then secrets+=",APNS_KEY=$APNS_SECRET_NAME:latest"; fi
g run deploy "$SERVICE" --source "$RELAY" --region "$REGION" \
  --service-account "$RUN_SA" --allow-unauthenticated \
  --execution-environment gen1 --cpu 1 --memory 256Mi --cpu-throttling \
  --concurrency 80 --max-instances 1 --min-instances 0 --timeout 60 --port 8080 \
  ${remove[@]+"${remove[@]}"} --update-env-vars "^|^$envs" --update-secrets "$secrets"

ACTUAL=$(g run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')
if [ -n "$FIRST" ] && [ -n "$ACTUAL" ] && [ "$ACTUAL" != "$URL" ]; then
  say "Cloud Run gave it $ACTUAL: setting RELAY_URL to that"
  g run services update "$SERVICE" --region "$REGION" --update-env-vars "RELAY_URL=$ACTUAL"
  URL=$ACTUAL
fi

say "Asking it how it is: $URL/v1/health"
health=""
for _ in $(seq 1 10); do
  if health=$(curl -fsS --max-time 10 "$URL/v1/health" 2>/dev/null); then break; fi
  health=""
  sleep 3
done
[ -n "$health" ] || die "it doesn't answer at $URL/v1/health yet. Its log says why:
  gcloud run services logs read $SERVICE --region $REGION --project $PROJECT"
note "$health"

cat <<EOF

The relay is up at $URL
  Build the phone apps with it: AMARCHY_RELAY=$URL (phone/README.md, "Builds").
  Its log:  gcloud run services logs read $SERVICE --region $REGION --project $PROJECT
  Again:    $0 $PROJECT $REGION   (changes only what's different)
EOF
