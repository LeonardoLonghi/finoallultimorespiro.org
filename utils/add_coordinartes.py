import csv
import time
import requests
from urllib.parse import quote

INPUT = 'public/a/data.csv'
OUTPUT = 'public/a/data_with_coords.csv'
USER_AGENT = 'finoallultimorespiro.org geocoder script ('

def geocode(query):
    url = f'https://nominatim.openstreetmap.org/search?q={quote(query)}&format=json&limit=1'
    headers = {'User-Agent': USER_AGENT}
    r = requests.get(url, headers=headers)
    if r.status_code == 200:
        results = r.json()
        if results:
            return results[0]['lat'], results[0]['lon']
    return None, None

with open(INPUT, newline='', encoding='utf-8') as inp, \
     open(OUTPUT, 'w', newline='', encoding='utf-8') as outp:
    reader = csv.DictReader(inp)
    writer = csv.writer(outp)
    writer.writerow(['lat','lng','caption','filename'])
    for row in reader:
        caption = row['caption']
        print(f'Geocoding: {caption} ...')
        lat, lon = geocode(caption)
        if lat and lon:
            writer.writerow([lat, lon, caption, row['filename']])
        else:
            print(f'  → Nessun risultato per "{caption}", lascio 0,0')
            writer.writerow(['0','0', caption, row['filename']])
        time.sleep(1.1)  # freccia per rispettare le regole di Nominatim

print(f'Done! Output salvato in "{OUTPUT}"')
