import requests


url = "https://ddragon.leagueoflegends.com/api/versions.json"

# Make a GET request to that URL.
response = requests.get(url)
# Parse the response as JSON.
versions = response.json()
# Get the first version (the current patch).
current_patch = versions[0]

# Print the current patch and the total number of patches.
print(f"The current League patch is: {current_patch}")
print(f"There are {len(versions)} total patches in League's history.")

