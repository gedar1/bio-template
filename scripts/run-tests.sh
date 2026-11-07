#!/bin/bash

# Get token
TOKEN_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/platform/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"secret":"test-secret-dev"}')

TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Failed to get token"
  exit 1
fi

# Test function
run_test() {
  local name=$1
  local input=$2
  local expected_activated=$3
  local expected_intent=$4
  local expected_strategy=$5
  local expected_chain_len=$6
  
  local response=$(curl -s -X POST "http://localhost:3000/api/semantic_route" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"tenant_id\":\"default\",\"user_message\":\"$input\"}")
  
  # Use python to parse JSON
  python3 - "$response" "$expected_activated" "$expected_intent" "$expected_strategy" "$expected_chain_len" << 'PYTHON'
import sys, json
response = json.loads(sys.argv[1])
data = response.get('data', response)
activated = len(data.get('activated_reflexes', []))
intent = data.get('intent_count', 0)
strategy = data.get('execution_strategy', 'sequential')
chain = len(data.get('execution_chain', []))

exp_activated = int(sys.argv[2])
exp_intent = int(sys.argv[3])
exp_strategy = sys.argv[4]
exp_chain = int(sys.argv[5])

passed = (activated == exp_activated and intent == exp_intent and 
          strategy == exp_strategy and chain == exp_chain)

print(f"activated={activated}|intent={intent}|strategy={strategy}|chain={chain}|passed={passed}")
PYTHON
}

# Run tests and collect results
echo "Running Fase 3 tests..."
cd c:/Users/GermanDarioArbelaez/Documents/project-agent/bio-template

# Wait for server
sleep 2

python3 scripts/test-phase3-manual.py 2>&1 | head -100
