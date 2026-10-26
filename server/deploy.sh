#!/usr/bin/env bash
# Deploys the MBQ API (phone check-in, club data, organizer sign-in) to AWS
# and prints the settings the app needs.
# Needs the AWS CLI signed in to your account. Region: AWS_REGION, default ap-southeast-1.
set -euo pipefail
cd "$(dirname "$0")"

STACK=mbq-checkin
export AWS_REGION=${AWS_REGION:-ap-southeast-1}

aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file template.yaml \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
FUNCTION=$(aws cloudformation describe-stack-resource --stack-name "$STACK" --logical-resource-id Function \
  --query StackResourceDetail.PhysicalResourceId --output text)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ZIP=$TMP/checkin.zip
zip -qj "$ZIP" lambda.mjs checkin.mjs club.mjs auth.mjs
aws lambda update-function-code --function-name "$FUNCTION" --zip-file "fileb://$ZIP" --query LastUpdateStatus --output text
aws lambda wait function-updated --function-name "$FUNCTION"

URL=$(output Url)
echo
echo "Settings for .env.production:"
echo "VITE_CHECKIN_API=${URL%/}"
echo "VITE_AUTH_URL=https://cognito-idp.$AWS_REGION.amazonaws.com/"
echo "VITE_COGNITO_CLIENT_ID=$(output ClientId)"
