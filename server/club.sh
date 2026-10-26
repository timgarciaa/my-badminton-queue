#!/usr/bin/env bash
# Clubs and organizer accounts. Run with your AWS profile, e.g.
#   AWS_PROFILE=personal server/club.sh requests
#
#   requests                            new clubs waiting for approval
#   approve-club <club-id>              let a new club's organizer in
#   decline-club <club-id>              delete a waiting club and its organizer's account
#   clubs                               list clubs, with their join codes
#   create-club <name>                  new club, already approved; prints its id
#   add-organizer <club-id> <username>  new organizer account (asks for the password)
#   set-password <username>             new password for an organizer (asks for it)
#   remove-organizer <username>         delete an organizer account
#   organizers                          list organizers and their clubs
#
# A new club can also be approved by setting its `approved` to true in the
# DynamoDB console (club table, item pk club#<id>, sk meta).
set -euo pipefail
cd "$(dirname "$0")"

case "${1:-}" in
  requests | approve-club | decline-club | clubs | create-club | add-organizer | set-password | remove-organizer | organizers) ;;
  *)
    sed -n '2,17p' "$(basename "$0")" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac

STACK=mbq-checkin
export AWS_REGION=${AWS_REGION:-ap-southeast-1}

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
POOL=$(output UserPoolId)
TABLE=$(output ClubTable)

# A DynamoDB key as JSON.
key() { printf '{"pk":{"S":"%s"},"sk":{"S":"%s"}}' "$1" "$2"; }
random() { python3 -c "import secrets; print(''.join(secrets.choice('$1') for _ in range($2)))"; }

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

club_name() {
  aws dynamodb get-item --table-name "$TABLE" --key "$(key "club#$1" meta)" --query 'Item.name.S' --output text
}

# Which club someone organizes (empty if none).
club_of() {
  local id
  id=$(aws dynamodb get-item --table-name "$TABLE" --key "$(key "user#$1" user)" --query 'Item.clubId.S' --output text)
  [[ "$id" == "None" ]] || echo "$id"
}

# Removes an organizer from their club and deletes their account.
remove_organizer() {
  local user=$1 club
  club=$(club_of "$user")
  if [[ -n "$club" ]]; then
    aws dynamodb delete-item --table-name "$TABLE" --key "$(key "club#$club" "member#$user")"
    aws dynamodb delete-item --table-name "$TABLE" --key "$(key "user#$user" user)"
  fi
  aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$user" 2>/dev/null || true
}

case "${1:-}" in
  requests)
    aws dynamodb scan --table-name "$TABLE" --filter-expression '#sk = :meta AND #approved = :no' \
      --expression-attribute-names '{"#sk":"sk","#approved":"approved"}' \
      --expression-attribute-values '{":meta":{"S":"meta"},":no":{"BOOL":false}}' \
      --query 'Items[].[pk.S, name.S, createdBy.S]' --output text | sed 's/^club#//' |
      awk -F'\t' 'BEGIN { n = 0 } { n++; printf "%s\t%s\t(asked by %s)\n", $1, $2, $3 } END { if (n == 0) print "No new clubs waiting." }'
    ;;
  approve-club)
    club=${2:?club id}
    aws dynamodb update-item --table-name "$TABLE" --key "$(key "club#$club" meta)" \
      --update-expression 'SET #approved = :yes' --condition-expression 'attribute_exists(#pk)' \
      --expression-attribute-names '{"#approved":"approved","#pk":"pk"}' \
      --expression-attribute-values '{":yes":{"BOOL":true}}'
    echo "Approved $(club_name "$club"). Its organizer can sign in now."
    ;;
  decline-club)
    club=${2:?club id}
    approved=$(aws dynamodb get-item --table-name "$TABLE" --key "$(key "club#$club" meta)" --query 'Item.approved.BOOL' --output text)
    [[ "$approved" == "False" ]] || { echo "$club isn't a club waiting for approval." >&2; exit 1; }
    name=$(club_name "$club")
    for user in $(aws dynamodb query --table-name "$TABLE" --key-condition-expression '#pk = :pk AND begins_with(#sk, :m)' \
      --expression-attribute-names '{"#pk":"pk","#sk":"sk"}' \
      --expression-attribute-values "{\":pk\":{\"S\":\"club#$club\"},\":m\":{\"S\":\"member#\"}}" \
      --query 'Items[].sk.S' --output text | tr '\t' '\n' | sed 's/^member#//'); do
      remove_organizer "$user"
    done
    code=$(aws dynamodb get-item --table-name "$TABLE" --key "$(key "club#$club" meta)" --query 'Item.code.S' --output text)
    [[ "$code" == "None" ]] || aws dynamodb delete-item --table-name "$TABLE" --key "$(key "code#$code" code)"
    aws dynamodb delete-item --table-name "$TABLE" --key "$(key "club#$club" meta)"
    echo "Declined $name."
    ;;
  clubs)
    aws dynamodb scan --table-name "$TABLE" --filter-expression '#sk = :meta' \
      --expression-attribute-names '{"#sk":"sk"}' --expression-attribute-values '{":meta":{"S":"meta"}}' \
      --query 'Items[].[pk.S, name.S, code.S, approved.BOOL]' --output text |
      sed 's/^club#//' | awk -F'\t' '{ printf "%s\t%s\tcode %s%s\n", $1, $2, $3, ($4 == "False" ? "\t(waiting for approval)" : "") }'
    ;;
  create-club)
    name=${2:?club name}
    slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//; s/-$//' | cut -c1-24)
    id="${slug:-club}-$(random abcdefghijklmnopqrstuvwxyz0123456789 4)"
    code=$(random ABCDEFGHJKLMNPQRSTUVWXYZ23456789 6)
    items=$(NAME="$name" ID="$id" CODE="$code" TABLE="$TABLE" python3 -c '
import json, os
t, i, c = os.environ["TABLE"], os.environ["ID"], os.environ["CODE"]
meta = {"pk": {"S": "club#" + i}, "sk": {"S": "meta"}, "name": {"S": os.environ["NAME"]}, "rev": {"N": "0"}, "code": {"S": c}, "approved": {"BOOL": True}}
code = {"pk": {"S": "code#" + c}, "sk": {"S": "code"}, "clubId": {"S": i}}
cond = {"ConditionExpression": "attribute_not_exists(#pk)", "ExpressionAttributeNames": {"#pk": "pk"}}
print(json.dumps([{"Put": {"TableName": t, "Item": meta, **cond}}, {"Put": {"TableName": t, "Item": code, **cond}}]))')
    aws dynamodb transact-write-items --transact-items "$items"
    echo "Created club \"$name\" with id: $id (join code $code)"
    ;;
  add-organizer)
    club=${2:?club id}
    user=$(echo "${3:?username}" | tr '[:upper:]' '[:lower:]')
    found=$(club_name "$club")
    [[ "$found" != "None" ]] || { echo "No club with id $club (see: $0 clubs)." >&2; exit 1; }
    [[ -z "$(club_of "$user")" ]] || { echo "$user already organizes a club." >&2; exit 1; }
    pw=$(ask_password)
    aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$user" --message-action SUPPRESS \
      --query User.Username --output text >/dev/null
    set_password "$user" "$pw" || { echo "The account was made but the password wasn't set. Run: $0 set-password $user" >&2; exit 1; }
    now=$(($(date +%s) * 1000))
    aws dynamodb transact-write-items --transact-items "[
      {\"Put\": {\"TableName\": \"$TABLE\", \"Item\": {\"pk\": {\"S\": \"user#$user\"}, \"sk\": {\"S\": \"user\"}, \"clubId\": {\"S\": \"$club\"}}}},
      {\"Put\": {\"TableName\": \"$TABLE\", \"Item\": {\"pk\": {\"S\": \"club#$club\"}, \"sk\": {\"S\": \"member#$user\"}, \"approved\": {\"BOOL\": true}, \"requestedAt\": {\"N\": \"$now\"}}}}
    ]"
    echo "Added $user as an organizer of $found."
    ;;
  set-password)
    user=${2:?username}
    set_password "$user" "$(ask_password)"
    echo "Password changed for $user."
    ;;
  remove-organizer)
    user=$(echo "${2:?username}" | tr '[:upper:]' '[:lower:]')
    remove_organizer "$user"
    echo "Removed $user."
    ;;
  organizers)
    aws dynamodb scan --table-name "$TABLE" --filter-expression '#sk = :user' \
      --expression-attribute-names '{"#sk":"sk"}' --expression-attribute-values '{":user":{"S":"user"}}' \
      --query 'Items[].[pk.S, clubId.S]' --output text | sed 's/^user#//'
    ;;
esac
