# PRD: Flight Log Manager

## Introduction

A modern web application for managing PX4 .ulg flight test logs with rich metadata. The app serves as a layer on top of the existing flight_review visualization tool, providing CRUD operations, drone model tracking, pilot management, tagging, and advanced search/filter capabilities. It supports three upload methods: web form upload, direct drone connection via Web Serial API, and Python script integration.

## Goals

- Provide a centralized dashboard for all test flight logs with key metadata visible at a glance
- Enable multiple upload methods: web form, Web Serial drone connection, and Python scripts
- Track flight statistics (total hours, hours by drone model)
- Support efficient log discovery through search, filtering, and pagination
- Integrate seamlessly with flight_review at `http://10.0.0.100:5006/` for detailed log visualization
- Extract and display GPS takeoff coordinates from .ulg files automatically

## User Stories

### US-001: Set up project structure and database
**Description:** As a developer, I need the foundational project structure with database schema so that flight logs can be stored and retrieved.

**Acceptance Criteria:**
- [ ] FastAPI backend project initialized with proper folder structure
- [ ] SQLite database with `flight_logs` table containing: id, title, pilot, serial_number, drone_model, duration_seconds, file_path, takeoff_lat, takeoff_lon, created_at, updated_at
- [ ] SQLite table for `tags`: id, name (unique)
- [ ] SQLite junction table `flight_log_tags`: flight_log_id, tag_id
- [ ] Database migrations/initialization script
- [ ] Pydantic models for API request/response validation
- [ ] Typecheck/lint passes

### US-002: Create REST API endpoints for flight logs
**Description:** As a developer, I need CRUD API endpoints so that the frontend can manage flight logs.

**Acceptance Criteria:**
- [ ] `GET /api/logs` - List logs with pagination (page, per_page: 25|50|100), returns total count
- [ ] `GET /api/logs/{id}` - Get single log with all details including tags
- [ ] `POST /api/logs` - Create log (accepts multipart form with .ulg file + metadata)
- [ ] `PUT /api/logs/{id}` - Update log metadata (title, pilot, comment, tags, drone_model)
- [ ] `DELETE /api/logs/{id}` - Delete log and associated .ulg file
- [ ] `GET /api/logs/{id}/download` - Download the .ulg file
- [ ] `GET /api/logs/{id}/parameters` - Return extracted parameters from .ulg file
- [ ] All endpoints return proper HTTP status codes and error messages
- [ ] Typecheck/lint passes

### US-003: Implement search and filter API
**Description:** As a developer, I need search and filter endpoints so users can find specific logs.

**Acceptance Criteria:**
- [ ] `GET /api/logs` accepts query params: `search` (searches title, pilot, comment, serial)
- [ ] `GET /api/logs` accepts query params: `drone_model`, `pilot`, `tags` (comma-separated)
- [ ] `GET /api/logs` accepts query params: `date_from`, `date_to` (ISO format)
- [ ] Filters can be combined (AND logic)
- [ ] `GET /api/stats` - Returns total flight hours and flight hours by drone model
- [ ] Typecheck/lint passes

### US-004: Implement tag management API
**Description:** As a developer, I need tag management endpoints so users can create and search tags.

**Acceptance Criteria:**
- [ ] `GET /api/tags` - List all tags, supports `search` query param for autocomplete
- [ ] `POST /api/tags` - Create new tag (returns existing if duplicate)
- [ ] Tags are case-insensitive (stored lowercase)
- [ ] Typecheck/lint passes

### US-005: Implement ULog metadata extraction service
**Description:** As a developer, I need a service to extract metadata from .ulg files so it auto-populates during upload.

**Acceptance Criteria:**
- [ ] Extract flight duration from .ulg file using pyulog
- [ ] Extract serial number from parameters if available (AIROLIT_SERIAL or similar)
- [ ] Extract flight date from .ulg timestamp
- [ ] Extract GPS takeoff coordinates (first valid lat/lon from vehicle_gps_position)
- [ ] Extract and cache full parameter list for parameter viewer
- [ ] Service returns structured metadata dict
- [ ] Typecheck/lint passes

### US-006: Set up React frontend project
**Description:** As a developer, I need the frontend project structure so that UI development can begin.

**Acceptance Criteria:**
- [ ] React project initialized with Vite and TypeScript
- [ ] TailwindCSS configured for styling
- [ ] React Router configured for navigation
- [ ] Axios or fetch wrapper for API calls
- [ ] Project builds without errors
- [ ] Typecheck/lint passes

### US-007: Create main flight log list page
**Description:** As a user, I want to see all my flight logs in a table so I can quickly browse them.

**Acceptance Criteria:**
- [ ] Table displays columns: Drone thumbnail, Model, Serial Number, Pilot, Title, Duration (formatted as HH:MM:SS), Tags, Comment (truncated), Date, Actions
- [ ] Drone model column shows thumbnail image from `/img/{model}.png`
- [ ] Comment shows first ~50 chars with "..." and full text on hover (tooltip)
- [ ] Tags displayed as colored badges/chips
- [ ] Actions column has: Edit button, Delete button, Download button, Flight Review link (opens in new tab)
- [ ] Flight Review link points to `http://10.0.0.100:5006/plot_app?log={log_id}`
- [ ] Parameter viewer button opens modal with parameter list
- [ ] Page header shows: Total Flights count, Total Flight Hours, Flight Hours by Model (XLT: X hrs, S1: X hrs, CX10: X hrs)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-008: Implement pagination controls
**Description:** As a user, I want pagination so I can navigate through many logs efficiently.

**Acceptance Criteria:**
- [ ] Pagination controls at bottom of table: Previous, Next, page numbers
- [ ] Dropdown to select per-page: 25, 50, 100
- [ ] Current page and total pages displayed
- [ ] Pagination state persisted in URL query params
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-009: Implement search bar
**Description:** As a user, I want to search logs by text so I can quickly find specific flights.

**Acceptance Criteria:**
- [ ] Search input field in page header
- [ ] Search triggers on Enter key or after 300ms debounce
- [ ] Searches across: title, pilot name, comment, serial number
- [ ] Search term persisted in URL query params
- [ ] Clear button to reset search
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-010: Implement filter panel
**Description:** As a user, I want to filter logs by various criteria so I can narrow down results.

**Acceptance Criteria:**
- [ ] Filter panel (collapsible sidebar or dropdown)
- [ ] Date range filter: start date and end date pickers
- [ ] Drone model filter: checkboxes for XLT, S1, CX10
- [ ] Pilot filter: dropdown with all unique pilots from database
- [ ] Tags filter: multi-select with autocomplete search
- [ ] "Clear All Filters" button
- [ ] Active filters shown as removable chips
- [ ] Filter state persisted in URL query params
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-011: Create upload form (file selection method)
**Description:** As a user, I want to upload a .ulg file with metadata so I can add new flight logs.

**Acceptance Criteria:**
- [ ] Upload button in header opens upload modal/page
- [ ] File input accepts only .ulg files
- [ ] On file select, auto-extracts: duration, date, serial number, GPS coordinates (shows loading state)
- [ ] Form fields: Title (required), Pilot (required, with autocomplete from existing pilots), Drone Model (required, dropdown: XLT/S1/CX10), Comment (optional textarea), Tags (optional, multi-select with create-new option)
- [ ] Pre-populated fields from extraction are editable
- [ ] Submit button uploads file and metadata
- [ ] Success message and redirect to log list
- [ ] Error handling with user-friendly messages
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-012: Create edit log modal
**Description:** As a user, I want to edit log metadata so I can correct or update information.

**Acceptance Criteria:**
- [ ] Edit button opens modal pre-filled with current values
- [ ] Editable fields: Title, Pilot, Drone Model, Comment, Tags
- [ ] Non-editable fields shown as read-only: Duration, Date, Serial Number, GPS coordinates
- [ ] Save button updates log and closes modal
- [ ] Cancel button discards changes
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-013: Implement delete confirmation
**Description:** As a user, I want a confirmation before deleting so I don't accidentally remove logs.

**Acceptance Criteria:**
- [ ] Delete button shows confirmation dialog
- [ ] Dialog shows log title and warns about permanent deletion
- [ ] Confirm button deletes log and removes from list
- [ ] Cancel button closes dialog without action
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-014: Create parameter viewer modal
**Description:** As a user, I want to view flight parameters so I can inspect drone configuration.

**Acceptance Criteria:**
- [ ] Parameter button opens modal with parameter list
- [ ] Parameters displayed in searchable/filterable table
- [ ] Columns: Parameter Name, Value
- [ ] Search input to filter parameters by name
- [ ] Loading state while fetching parameters
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-015: Implement tag management in upload/edit forms
**Description:** As a user, I want to create and select tags so I can categorize my flights.

**Acceptance Criteria:**
- [ ] Tag input field with autocomplete dropdown
- [ ] Typing shows matching existing tags
- [ ] Option to create new tag if no match
- [ ] Selected tags shown as removable chips
- [ ] New tags created on-the-fly when form submitted
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-016: Implement Web Serial drone connection
**Description:** As a user, I want to connect to my drone via USB so I can directly download logs.

**Acceptance Criteria:**
- [ ] "Connect Drone" button in header (only visible in Chrome/Edge)
- [ ] Button requests serial port access via Web Serial API
- [ ] On connection, establishes MAVLink communication (115200 baud)
- [ ] Fetches and displays drone serial number
- [ ] Shows connection status indicator (connected/disconnected)
- [ ] Disconnect button to close connection
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-017: Implement drone log list and download
**Description:** As a user, I want to see logs on my connected drone so I can select which ones to upload.

**Acceptance Criteria:**
- [ ] After drone connection, "Drone Logs" panel appears
- [ ] Fetches log list from drone via MAVLink
- [ ] Shows log list with: Log ID, Date, Size
- [ ] Checkbox selection for multiple logs
- [ ] "Download Selected" button triggers download via MAVLink
- [ ] Progress indicator during download
- [ ] After download, opens upload form pre-populated with .ulg file
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-018: Create Python upload script
**Description:** As a developer/user, I need a Python script to upload logs programmatically.

**Acceptance Criteria:**
- [ ] Python script in `scripts/upload_log.py`
- [ ] Accepts arguments: --file (path to .ulg), --title, --pilot, --drone-model, --comment, --tags (comma-separated)
- [ ] --pilot and --drone-model are required
- [ ] Uploads to API endpoint with multipart form
- [ ] Prints success message with log ID
- [ ] Prints error message on failure
- [ ] Supports --api-url flag (defaults to http://localhost:8000)
- [ ] Typecheck/lint passes

### US-019: Add responsive design
**Description:** As a user, I want the app to work on different screen sizes.

**Acceptance Criteria:**
- [ ] Layout adapts for desktop (>1024px), tablet (768-1024px), mobile (<768px)
- [ ] Table becomes scrollable horizontally on small screens
- [ ] Filter panel collapses to dropdown on mobile
- [ ] Upload form stacks fields vertically on mobile
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-020: Configure CORS and static file serving
**Description:** As a developer, I need the backend to serve the frontend and handle CORS.

**Acceptance Criteria:**
- [ ] FastAPI serves React build from `/static` or root
- [ ] CORS configured to allow frontend origin during development
- [ ] API routes prefixed with `/api`
- [ ] Static files for drone images served from `/img`
- [ ] Typecheck/lint passes

## Functional Requirements

- FR-1: The system must store flight log metadata in SQLite database with .ulg files on the local filesystem
- FR-2: The system must extract duration, date, serial number, and GPS coordinates from .ulg files using pyulog
- FR-3: The system must support three drone models: XLT, S1, CX10, each with a corresponding thumbnail image
- FR-4: The system must display flight logs in a paginated table with 25, 50, or 100 items per page
- FR-5: The system must allow searching logs by title, pilot, comment, and serial number
- FR-6: The system must allow filtering logs by date range, drone model, pilot, and tags
- FR-7: The system must support creating, editing, and deleting flight logs
- FR-8: The system must calculate and display total flight hours and flight hours per drone model
- FR-9: The system must link to flight_review at `http://10.0.0.100:5006/plot_app?log={log_id}` for detailed visualization
- FR-10: The system must provide a parameter viewer showing all parameters extracted from the .ulg file
- FR-11: The system must support tag creation and assignment with searchable autocomplete
- FR-12: The system must support Web Serial API for direct drone connection in compatible browsers
- FR-13: The system must implement MAVLink protocol in JavaScript to communicate with connected drones
- FR-14: The system must allow downloading log list and individual logs from connected drones
- FR-15: The system must provide a Python script for programmatic log uploads
- FR-16: The system must show truncated comments with full text visible on hover
- FR-17: The system must persist search, filter, and pagination state in URL query parameters

## Non-Goals

- No user authentication or authorization (local server only)
- No real-time notifications or WebSocket updates
- No log comparison features
- No automatic log syncing or scheduled uploads
- No cloud storage integration
- No modification of the flight_review codebase
- No support for log formats other than .ulg
- No drone configuration or parameter writing capabilities

## Design Considerations

- **UI Framework:** Use TailwindCSS for a modern, clean appearance
- **Color Scheme:** Professional/technical aesthetic suitable for engineering use
- **Drone Thumbnails:** Use existing images from `img/` folder (CX10.png, S1.png, XLT.png)
- **Table Design:** Clean data table with alternating row colors, hover states
- **Modals:** Use for upload, edit, delete confirmation, and parameter viewer
- **Responsive:** Mobile-friendly but optimized for desktop use

## Technical Considerations

- **Backend:** FastAPI (Python 3.10+)
- **Frontend:** React 18+ with TypeScript, Vite, TailwindCSS
- **Database:** SQLite (simple, no additional infrastructure)
- **ULog Parsing:** Use pyulog library (same as airolog and flight_review)
- **Web Serial:** Use Web Serial API with MAVLink.js or custom implementation
- **File Storage:** Store .ulg files in `data/logs/` directory with UUID filenames
- **Flight Review Integration:** Link format `http://10.0.0.100:5006/plot_app?log={filename}` - verify exact URL format with flight_review docs
- **MAVLink Reference:** Use `airolog/client/airolit_drone_api.py` as reference for MAVLink communication patterns

## Success Metrics

- All CRUD operations work reliably
- Search returns results in under 500ms for 1000+ logs
- Pagination handles 10,000+ logs without performance issues
- Web Serial connection works in Chrome/Edge on Windows and Linux
- Python upload script successfully uploads logs with all metadata
- UI renders correctly on screens 1024px and wider

## Open Questions

1. What is the exact URL format for flight_review log viewing? Need to verify if it uses log ID, filename, or upload token
2. Should the parameter viewer support parameter export (CSV/JSON)?
3. Should there be a bulk delete option for multiple logs?
4. Should GPS coordinates be displayed on a map thumbnail in the log list?
5. What MAVLink message types does the drone use for log list/download? (Reference alcli tools behavior)
