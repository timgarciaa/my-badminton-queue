#!/usr/bin/env bash
# Clubs and organizer accounts. Run with your AWS profile, e.g.
#   AWS_PROFILE=personal server/club.sh create-club "Serve N' Shout"
#
#   create-club <name>                  new club; prints its id
#   clubs                               list clubs
#   add-organizer <club-id> <username>  new organizer account (asks for the password)
#   set-password <username>             new password for an organizer (asks for it)
#   remove-organizer <username>         delete an organizer account
#   organizers                          list organizer accounts and their clubs
set -euo pipefail
cd "$(dirname "$0")"

STACK=mbq-checkin
export AWS_REGION=${AWS_REGION:-ap-southeast-1}

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
POOL=$(output UserPoolId)
TABLE=$(output ClubTable)

# Reads a password twice without showing it, as a JSON string.
ask_password() {
  local pw pw2
  read -rsp "Password (8+ characters): " pw && echo >&2
  read -rsp "Same password again: " pw2 && echo >&2
  [[ "$pw" == "$pw2" ]] || { echo "Passwords don't match." >&2; exit 1; }
  [[ ${#pw} -ge 8 ]] || { echo "Use at least 8 characters." >&2; exit 1; }
  PW="$pw" python3 -c 'import json, os; print(json.dumps(os.environ["PW"]))'
}

# Sets a permanent password. It goes in a file only this user can read (and
# deleted straight after) so it doesn't show in the process list.
set_password() {
  local user=$1 pw_json=$2 dir
  dir=$(mktemp -d)
  chmod 700 "$dir"
  printf '{"UserPoolId":"%s","Username":"%s","Password":%s,"Permanent":true}' "$POOL" "$user" "$pw_json" >"$dir/input.json"
  aws cognito-idp admin-set-user-password --cli-input-json "file://$dir/input.json" || { rm -rf "$dir"; return 1; }
  rm -rf "$dir"
}

case "${1:-}" in
  create-club)
    name=${2:?club name}
    slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//; s/-$//' | cut -c1-24)
    id="${slug:-club}-$(python3 -c 'import secrets, string; print("".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(4)))')"
    item=$(NAME="$name" ID="$id" python3 -c 'import json, os; print(json.dumps({"pk": {"S": "club#" + os.environ["ID"]}, "sk": {"S": "meta"}, "name": {"S": os.environ["NAME"]}, "rev": {"N": "0"}}))')
    aws dynamodb put-item --table-name "$TABLE" --item "$item" --condition-expression 'attribute_not_exists(pk)'
    echo "Created club \"$name\" with id: $id"
    ;;
  clubs)
    aws dynamodb scan --table-name "$TABLE" --filter-expression 'sk = :meta' \
      --expression-attribute-values '{":meta":{"S":"meta"}}' \
      --query 'Items[].[pk.S, name.S]' --output text | sed 's/^club#//'
    ;;
  add-organizer)
    club=${2:?club id}
    user=${3:?username}
    found=$(aws dynamodb get-item --table-name "$TABLE" --key "{\"pk\":{\"S\":\"club#$club\"},\"sk\":{\"S\":\"meta\"}}" --query 'Item.name.S' --output text)
    [[ "$found" != "None" ]] || { echo "No club with id $club (see: $0 clubs)." >&2; exit 1; }
    pw=$(ask_password)
    aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$user" \
      --user-attributes "Name=custom:club,Value=$club" --message-action SUPPRESS --query User.Username --output text >/dev/null
    set_password "$user" "$pw" || { echo "The account was made but the password wasn't set. Run: $0 set-password $user" >&2; exit 1; }
    echo "Added $user as an organizer of $found."
    ;;
  set-password)
    user=${2:?username}
    set_password "$user" "$(ask_password)"
    echo "Password changed for $user."
    ;;
  remove-organizer)
    user=${2:?username}
    aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$user"
    echo "Removed $user."
    ;;
  organizers)
    aws cognito-idp list-users --user-pool-id "$POOL" \
      --query 'Users[].[Username, Attributes[?Name==`custom:club`].Value | [0]]' --output text
    ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
