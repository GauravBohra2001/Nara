# Nara

Nara is a women’s health intelligence platform that converts Apple Watch data into personalized, real-time insights. It builds an individual baseline using metrics like heart rate, HRV, sleep, and activity, instead of relying on generic health averages. Using machine learning, it detects menstrual cycle phases automatically and identifies daily physiological deviations. The system then generates context-aware interventions based on the user’s body and cycle state. Unlike traditional dashboards, Nara focuses on continuous understanding and actionable guidance. It is built with a FastAPI backend and a premium Next.js frontend designed for a consumer health experience.

## Run

Backend:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.
