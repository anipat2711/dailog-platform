# Dailog Platform — Project Instructions

## Project Overview
This is an AI-powered story generation platform for Companion Labs content team.
Non-technical users can generate complete 25-episode interactive story arcs.

## Tech Stack
- Frontend: React 18 + Vite
- Styling: Tailwind CSS
- State: Zustand
- Routing: React Router v6
- API Caching: React Query (TanStack)
- HTTP: Axios
- Database: MongoDB + Prisma (coming soon)

## Design System
- Background: #0a0a0f
- Card background: #12121a
- Primary accent: #7c3aed (purple)
- Secondary accent: #06b6d4 (cyan)
- Success: #10b981 (green)
- Text primary: #f8fafc
- Text secondary: #94a3b8
- Border: #1e1e2e
- Theme: Dark, premium, high-end

## Project Structure
src/
  components/common/     → Shared components
  components/layout/     → Sidebar, navbar
  pages/Login/           → Login page
  pages/Home/            → Home + prompt bar
  pages/Dashboard/       → Netflix-style grid
  pages/Story/           → Story viewer + editor
  store/                 → Zustand stores
  hooks/                 → Custom hooks
  services/              → Claude API, Gemini API, Auth
  utils/                 → Helper functions
  assets/                → Images, icons

## Authentication
- Only @cmpntech.com emails allowed
- JWT stored in localStorage
- Zustand auth store persists on refresh

## API Keys
All keys are in .env file only — never commit keys to code or docs.
- CLAUDE_API_KEY → in .env (backend only)
- GEMINI_API_KEY → in .env (backend only)
- MONGODB_URI → in .env
- JWT_SECRET → in .env
- VITE_API_BASE_URL → in .env

## Story Generation Rules
- Use ONLY dailog-episode-generator skill format
- Output: Hero Profile + 25 Episodes + User Role +
  Transition Message + First Message
- Format exactly like ChhotiBahu_episodes.txt
- Language: Always Hinglish

## Image Generation Rules
- Character images: name + role + description from story
- Scene images: characters + location + mood per episode
- Main image: employee prompt — which character + background
- Character consistency: reference image saved per character
- If character image changes → update all scenes with that character
- If scene image changes → only that scene changes

## Performance Rules
- Lazy load every page
- Images on Cloudinary (URLs in DB only)
- Zustand for state — not Redux
- React Query for API caching
- Debounced auto-save (2 second delay)
- Async generation with progress bar
- Rate limiting on all API routes

## Permissions
- All employees can VIEW all stories
- Only CREATOR can EDIT or DELETE their stories
- Auto-save on every change

## Status Tracking
- Draft → Story text generated, no images
- In Progress → Some images generated
- Complete → All content ready

## Image Generation Models
Models confirmed working with our Gemini key:
- gemini-2.5-flash-image (Nano Banana)
- gemini-3.1-flash-image-preview (Nano Banana 2)
- gemini-3-pro-image-preview (Nano Banana Pro)

## Editing Rules
- Character image edit → cascades to all scenes with that character
- Scene image edit → character appearance stays consistent always
- Hero image edit → cascades to ALL 25 episode scenes
- All edits use character reference images as multimodal input
- DB always stores latest image URLs
- Old images deleted when replaced (unique filenames)
- Auto-save: 2 second debounce for text edits

## Current Progress
- Phase 1 ✅ → Foundation (React+Vite+Tailwind+Zustand+ReactQuery)
- Phase 2 ✅ → Authentication (JWT, @cmpntech.com only, localStorage)
- Phase 3 ✅ → Dashboard (Netflix grid, search, story cards, detail page)
- Phase 4 ✅ → Story Generation (Claude API, dailog-episode-generator skill)
- Phase 5 ✅ → Image Generation (Gemini/Nano Banana, character+scene+cover)
- Phase 6 ✅ → Database Integration (MongoDB, all models, auto-save)
- Phase 7 ✅ → Editing System (episode, character image, scene image, cover image)
- Phase 8 ⏳ → Polish + Vercel Deploy
