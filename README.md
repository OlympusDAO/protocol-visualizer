# Protocol Visualizer

This repository contains the source code for a visualizer of the Olympus protocol.

To be specific, it visualizes the following:

- Modules
- Kernel
- Policies
- Roles
- Role Assignments
- Role Assignees

## Components

The project is made up of two components:

- Indexer
  - This uses the Ponder framework to index blockchain events
- Frontend
  - A static frontend that retrieves records from the indexer and renders them in a diagram

## Deployment

Note: WIP

- PostgreSQL database
  - Hosted on a Google Compute Engine VM
- Indexer
  - Hosted on a Google Compute Engine VM
- Frontend
  - Hosted on Fleek
