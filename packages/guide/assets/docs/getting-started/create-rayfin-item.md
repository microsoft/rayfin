---
sidebar_position: 4
title: Create an App Backend
---

This guide walks through creating a new Fabric data app directly in the Microsoft Fabric portal.

## Prerequisites

- A Microsoft account with access to Microsoft Fabric.
- A Fabric workspace where you have contributor or admin permissions.
- Fabric data app enabled in your tenant admin settings (see below).

## Enable Fabric data app in tenant admin settings

A Fabric tenant administrator must enable the Fabric data app workload before users can create Rayfin items.
If you are not a tenant admin, contact your organization's Fabric administrator to complete this step.

1. Sign in to the [Fabric admin portal](https://app.fabric.microsoft.com/admin-portal).
1. Navigate to **Tenant settings**.
1. Under **Fabric Apps (preview)**, toggle the setting to **Enabled**.
1. Choose whether to enable it for the entire organization or specific security groups.
1. Click **Apply**.

Changes may take a few minutes to propagate.
Once enabled, users in the allowed scope can create Fabric data apps in their workspaces.

## Step 1: Sign in to the Fabric portal

Open [Microsoft Fabric](https://app.fabric.microsoft.com) in your browser and sign in with your Microsoft account.

## Step 2: Select a workspace

After signing in, select a workspace from the left navigation panel.
If you do not have an existing workspace, create one:

1. Click **Workspaces** in the left navigation.
1. Click **New workspace**.
1. Enter a name for the workspace and select Fabric capacity.

## Step 3: Create a new Fabric data app

1. In the workspace view, click **New item**.
1. Search for **Fabric data app** in the item type list or scroll to find it.
1. Select **Fabric data app** to open the creation dialog.
1. Enter a name for your Fabric data app (for example, `my-rayfin-app`).
1. Click **Create**.

## Step 4: Open, edit, and deploy your app

After creating the Fabric data app, create or open a Rayfin project on your computer.

1. If you don't have a project yet, run `npm create @microsoft/rayfin@latest` and select a template.
1. Open the project in your preferred editor and make changes to your app.
1. From your project root, deploy to the workspace and data app you created:

   ```bash
   npx rayfin up --workspace-id <workspace-guid> --item-name "<data-app-name>"
   ```

   Replace the placeholders with your Fabric workspace ID and the data app name.
   If the project already has a recorded deployment in that workspace, it cannot be retargeted to a different data app; use a different project or workspace.
1. When prompted, confirm that you want to reuse the existing data app and overwrite its configuration.
1. Once deployment completes, open the **Hosting URL** from the terminal output in a browser to verify your changes.

See [Deploy to Microsoft Fabric](../app-backend/deploy.md) to learn more about deployment options.

## Next steps

- Explore [Data Models & Decorators](../data/overview.md) to define your backend schema.
- Learn how to connect frontends with the [GraphQL guide](../data/graphql.md).
- Configure authentication with [Rayfin Auth](../auth/overview.md).
