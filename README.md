# \# VertexShape

# 

# VertexShape is a browser-based 3D OBJ viewer built with Three.js. It loads `.obj` files locally in the browser, renders them in real time, and displays edge measurements, bounding box dimensions, and edge counts. The UI is minimal and dark-themed for distraction-free model inspection.

# 

# \## Core Functionality

# \- Load `.obj` models directly from local files (no server upload required)

# \- Automatically fit the camera to the loaded model

# \- Detect and merge collinear edges

# \- Display the number of edges and the bounding box size in centimeters

# \- Click on an edge to view its length label positioned directly along the edge

# \- Rotating cube placeholder until a model is loaded

# 

# \## How It Works

# \- \*\*index.html\*\* sets up the UI, toolbar, and includes Three.js + supporting scripts

# \- \*\*style.css\*\* defines a dark mode interface and styling for the toolbar, badges, and edge labels

# \- \*\*viewer.js\*\*:

# &nbsp; - Initializes the Three.js scene, camera, lights, and OrbitControls

# &nbsp; - Loads `.obj` files via `OBJLoader`

# &nbsp; - Computes bounding box size in cm and total edge count

# &nbsp; - Generates edge segments and merges collinear lines

# &nbsp; - Positions labels in 2D screen space aligned with the corresponding edges

# &nbsp; - Toggles the grid only when a model is loaded

# &nbsp; - Continuously renders the scene, updating labels and allowing orbit controls

# 

# \## Online Hosting

# The project is fully static and can be deployed via GitHub Pages:

# 1\. Upload all files to a GitHub repository

# 2\. Enable \*\*Pages\*\* in repository settings (`main` branch, root folder)

# 3\. Access via:

# 

