#!/usr/bin/env bash
# Deploys the phone check-in API to AWS and prints its URL.
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

ZIP=$(mktemp -d)/checkin.zip
zip -qj "$ZIP" lambda.mjs checkin.mjs
aws lambda update-function-code --function-name "$FUNCTION" --zip-file "fileb://$ZIP" --query LastUpdateStatus --output text
aws lambda wait function-updated --function-name "$FUNCTION"

URL=$(output Url)
echo
echo "Check-in API: ${URL%/}"
echo "Put it in .env.production as VITE_CHECKIN_API=${URL%/}"
