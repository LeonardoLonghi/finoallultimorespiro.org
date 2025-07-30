#!/bin/bash

output="public/a/data.csv"
echo "lat,lng,caption,filename" > "$output"

for year in public/a/202*/; do
  for file in "$year"*; do
    if [[ -f "$file" ]]; then
      name=$(basename "$file")
      caption="${name%.[jJ][pP][gG]}"
      path="$file"
      echo "0,0,$caption,$path" >> "$output"
    fi
  done
done

echo "CSV generato in $output"
