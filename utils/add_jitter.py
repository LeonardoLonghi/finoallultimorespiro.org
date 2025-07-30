import pandas as pd
import random

# Carica il CSV
df = pd.read_csv("public/a/data_with_coords.csv")

# Arrotonda per trovare duplicati con una certa tolleranza
coord_counts = df.groupby(["lat", "lng"]).size()

# Trova le coordinate duplicate
duplicates = coord_counts[coord_counts > 1].index

# Mappa per contare quante volte abbiamo già jitterato ogni punto
jitter_tracker = {}

# Funzione per aggiungere rumore (jitter)
def jitter(lat, lng, factor=0.0002):
    return lat + random.uniform(-factor, factor), lng + random.uniform(-factor, factor)

# Applica jitter solo ai duplicati
for i, row in df.iterrows():
    key = (row["lat"], row["lng"])
    if key in duplicates:
        count = jitter_tracker.get(key, 0)
        if count > 0:  # il primo lo lasciamo com'è, jitteriamo solo i successivi
            new_lat, new_lng = jitter(row["lat"], row["lng"])
            df.at[i, "lat"] = new_lat
            df.at[i, "lng"] = new_lng
        jitter_tracker[key] = count + 1

# Salva il file modificato
df.to_csv("data_with_jitter.csv", index=False)
print("Creato: data_with_jitter.csv")
