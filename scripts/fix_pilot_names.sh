#!/bin/bash
# Pilot name cleanup for production
SERVER="https://10.0.0.60"

merge() {
  echo "Merging '$1' -> '$2'"
  curl -sk -X POST "$SERVER/api/pilots/merge" \
    -H 'Content-Type: application/json' \
    -d "{\"from_name\": \"$1\", \"to_name\": \"$2\"}" 2>/dev/null
  echo
}

merge_before() {
  echo "Merging '$1' -> '$2' (before $3)"
  curl -sk -X POST "$SERVER/api/pilots/merge" \
    -H 'Content-Type: application/json' \
    -d "{\"from_name\": \"$1\", \"to_name\": \"$2\", \"before_date\": \"$3\"}" 2>/dev/null
  echo
}

merge_after() {
  echo "Merging '$1' -> '$2' (after $3)"
  curl -sk -X POST "$SERVER/api/pilots/merge" \
    -H 'Content-Type: application/json' \
    -d "{\"from_name\": \"$1\", \"to_name\": \"$2\", \"after_date\": \"$3\"}" 2>/dev/null
  echo
}

echo "=== Step 1: Normalize casing ==="
curl -sk -X POST "$SERVER/api/pilots/normalize-casing"
echo -e "\n"

echo "=== Step 2: Unknowns ==="
merge "??" "Unknown"
merge "Airolit" "Unknown"
merge "Finland" "Unknown"
merge "Test" "Unknown"

echo "=== Step 3: Daniel split ==="
merge "Daniel <Lastname>" "Daniel Old"
merge_before "Daniel" "Daniel Old" "2025-01-01"
merge_after "Daniel" "Daniel Jakobsson" "2025-01-01"

echo "=== Step 4: Alex ==="
merge "Alex" "Oleksandr Blaha"

echo "=== Step 5: Anton variants ==="
merge "Anton T" "Anton Taléus"
merge "Talle" "Anton Taléus"
merge "Talle 200" "Anton Taléus"
merge "Tally" "Anton Taléus"

echo "=== Step 6: Cameron variants ==="
merge "Cam" "Cameron"
merge "Cameron 200" "Cameron"
merge "Cameron Theo" "Cameron"
merge "Cammy" "Cameron"
merge "Cman" "Cameron"

echo "=== Step 7: Joachim variants ==="
merge "Jh The Best" "Joachim Hagedorn"
merge "Joachim" "Joachim Hagedorn"
merge "Joaquin" "Joachim Hagedorn"
merge "Jocke" "Joachim Hagedorn"
merge "Jocke Igen" "Joachim Hagedorn"
merge "Jocke The Best" "Joachim Hagedorn"
merge "Jocke The Great" "Joachim Hagedorn"
merge "Jocke The Hero" "Joachim Hagedorn"
merge "Jocke The King" "Joachim Hagedorn"
merge "Jocke The Man" "Joachim Hagedorn"
merge "Jocke, The Man" "Joachim Hagedorn"
merge "Jocke, The Man..." "Joachim Hagedorn"
merge "Joki" "Joachim Hagedorn"

echo "=== Step 8: Theo variants ==="
merge "Theo" "Theodor Larsson"
merge "Theo Anton T" "Theodor Larsson"
merge "Theodore 200" "Theodor Larsson"

echo "=== Step 9: Other renames ==="
merge "Claes" "Claes Svensson"
merge "Sumon" "Simon"
merge "Frans Erik" "Frans-Erik"
merge "Frasse" "Frans-Erik"
merge "Edvin" "Edvin Mellberg"
merge "Filip" "Filip Pihlqvist"
merge "Isak" "Isak Åslund"
merge "Patrik" "Patrik Werner"
merge "Philip" "Philip Gisslow"
merge "Rasmus" "Rasmus Saab"
merge "Robert" "Robert Bagge"
merge "Thomas" "Thomas Cacher-Eloranta"
merge "Tim" "Tim Johansson"

echo "=== Done! Checking result ==="
curl -sk "$SERVER/api/pilots"
echo
