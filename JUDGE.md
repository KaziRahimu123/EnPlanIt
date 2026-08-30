# ⚖️ EnPlanIt — 90-Second Judge's Guide

Welcome IBM Challenge Judges! Follow these 5 quick steps to test EnPlanIt on the live app in under 90 seconds.

---

### Step 1: Open the Live Application
Visit [https://enplanit-web.vercel.app/](https://enplanit-web.vercel.app/) and click **"Sign In"** or **"Launch Mission Cockpit"** to log in via Auth0.

### Step 2: Ingest Mission Flight Specs (Multi-Source Ingestion)
Go to `/missions/create` and upload a spaceflight dossier (PDF, DOCX, TXT, MD up to 3 files / 20 MB) or enter a natural-language mission concept (e.g. *Artemis Base Alpha 365-Day Crewed Lunar Outpost*).

### Step 3: Experience the Mission Analysis Cockpit
Watch **IBM Granite 20B on watsonx.ai (`ibm/granite-20b-multilingual`)** synthesize flight telemetry into structured intelligence in seconds:
- 🪐 **Interactive Orbital Topological Map**: Trace live dependencies between Power, Communications, Thermal, Life Support, and Science.
- 📊 **6 Extracted or Derived Mission Variables**: View extracted solar flux, orbital period, battery depth-of-discharge, and comms latency with document citations.
- 📋 **Preliminary Mission Assessments**: Review structured action plans and step-by-step operational directives.

### Step 4: Test the Deterministic Scenario Lab
Navigate to `/scenario-lab` and stress-test mission trade-offs using rule-based mission calculations:
- Click quick presets (e.g. **`Solar Blackout -45%`**, **`Duration +180 Days`**, or **`35-Min Comms Lag`**) or adjust sliders.
- Observe real-time **Dependency & Cascading-Risk Visualization** and automated **Reference-Based Life Support Alerts** trigger with engineering countermeasures.

### Step 5: Test Role-Specific Workspace Views
Click the role badge in the top navigation bar to switch between **Mission Controller** and **Mission Risk & Safety Analyst** to inspect tailored workspace views and subsystem safety margins with zero data loss!
