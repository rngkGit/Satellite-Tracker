import os
import sys
import time
import json
import ssl
import urllib.request
from http.server import SimpleHTTPRequestHandler, HTTPServer

PORT = 8080
TLE_CACHE_FILE = "active_satellites.tle"
TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
CACHE_EXPIRY_SECONDS = 24 * 60 * 60  # 24 hours

class SatelliteProxyServer(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow CORS requests just in case
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_GET(self):
        if self.path == '/api/satellites':
            self.handle_api_satellites()
        else:
            # Default to serving static files
            super().do_GET()

    def handle_api_satellites(self):
        try:
            tle_content = self.get_tle_data()
            satellites = self.parse_tle_data(tle_content)
            
            # Send JSON response
            response_data = json.dumps(satellites).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response_data)))
            self.end_headers()
            self.wfile.write(response_data)
        except Exception as e:
            # Handle server-side errors gracefully
            error_message = json.dumps({"error": str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(error_message)))
            self.end_headers()
            self.wfile.write(error_message)

    def get_tle_data(self):
        """Fetches TLE data from CelesTrak, using a local cache file if valid."""
        cache_exists = os.path.exists(TLE_CACHE_FILE)
        cache_valid = False

        if cache_exists:
            file_age = time.time() - os.path.getmtime(TLE_CACHE_FILE)
            if file_age < CACHE_EXPIRY_SECONDS:
                cache_valid = True

        if cache_valid:
            print("Loading TLE data from local cache...")
            with open(TLE_CACHE_FILE, "r", encoding="utf-8") as f:
                return f.read()
        else:
            print("Fetching fresh TLE data from CelesTrak API...")
            try:
                # Add a user-agent header to avoid being blocked
                req = urllib.request.Request(
                    TLE_URL,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VectorTracker/1.0'}
                )
                # Avoid macOS certificate errors by using an unverified SSL context
                context = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=15, context=context) as response:
                    content = response.read().decode('utf-8')
                
                # Save to local cache
                with open(TLE_CACHE_FILE, "w", encoding="utf-8") as f:
                    f.write(content)
                return content
            except Exception as e:
                # If network fails but cache exists, fall back to cached copy (even if expired)
                if cache_exists:
                    print(f"Network fetch failed ({e}). Falling back to expired local cache.")
                    with open(TLE_CACHE_FILE, "r", encoding="utf-8") as f:
                        return f.read()
                else:
                    raise Exception(f"Failed to fetch satellite orbits from server and no local cache was found. Error: {e}")

    def parse_tle_data(self, content):
        """Parses CelesTrak 3-line TLE format and outputs categorized JSON."""
        satellites = []
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        
        i = 0
        while i < len(lines) - 2:
            name = lines[i]
            line1 = lines[i+1]
            line2 = lines[i+2]
            
            # TLE lines should start with '1 ' and '2 '
            if line1.startswith('1 ') and line2.startswith('2 '):
                # Extract clean NORAD catalog ID
                norad_id = line1[2:7].strip()
                
                # Determine grouping based on satellite name
                name_upper = name.upper()
                
                # Standard classification mappings
                if "STARLINK" in name_upper:
                    group = "comms"
                elif "GPS" in name_upper or "NAVSTAR" in name_upper:
                    group = "GPS"
                elif any(key in name_upper for key in ["DEBRIS", "FRAG", "COLL", "R/B", "BOOSTER", "DECAY"]):
                    group = "debris"
                elif any(key in name_upper for key in ["ISS", "ZARYA", "HST", "HUBBLE", "NOAA", "AQUA", "TERRA", "LANDSAT", "METEOSAT", "GOES"]):
                    group = "science"
                elif any(key in name_upper for key in ["ONEWEB", "IRIDIUM", "O3B", "FLOCK", "LEMUR", "ORBCOMM", "AMAZON", "BEIDOU", "GALILEO"]):
                    group = "comms"
                else:
                    # Generic fallback
                    group = "science"
                
                satellites.append({
                    "id": norad_id,
                    "name": name,
                    "group": group,
                    "line1": line1,
                    "line2": line2
                })
                i += 3
            else:
                i += 1
                
        return satellites

def run_server():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, SatelliteProxyServer)
    print(f"Vector Satellite Tracker Proxy Web Server active on port {PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        sys.exit(0)

if __name__ == '__main__':
    run_server()
