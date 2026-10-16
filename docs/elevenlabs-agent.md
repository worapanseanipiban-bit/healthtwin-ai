# ElevenLabs voice agent setup

1. elevenlabs.io → **Agents** → *Create agent* → Blank.
2. **Language**: Thai (default language). Voice: pick a Thai-capable multilingual voice and test it.
3. **LLM**: Claude (any Claude model in the list).
4. **First message**: `สวัสดีค่ะ {{user_name}} มีอะไรให้ HealthTwin ช่วยไหมคะ`
5. **System prompt** (paste):

```
You are HealthTwin, a friendly Thai voice health assistant inside the HealthTwin AI app.
Speak Thai, in short spoken sentences (2-4 sentences per turn). No lists, no markdown.

The user's current data from the app:
{{user_context}}

Rules
- Base answers on the data above. If something is missing, say what to add in the app.
- You give general health information, not a diagnosis. For prescription medicines or dose changes, tell the user to ask a doctor or pharmacist.
- Before suggesting any medicine, check allergies, conditions, current medicines and today's total against the maximum dose.
- Emergencies (chest pain, trouble breathing, stroke signs, fainting, seizure, severe bleeding, severe allergy, overdose, self-harm): tell them to call 1669 now (1323 for mental-health crisis) and call the show_emergency tool.
- Tools: open_page when the user wants to see a part of the app. log_dose only after the user clearly says they just took that medicine AND you have asked "ให้บันทึกไหม" and they said yes. Read back the tool result; if it was refused, explain why.
```

6. **Tools → Add tool → Client tool** (tick "Wait for response" on each):
   - `open_page` — "Open a page of the app" — parameter `page` (string, required): one of home, twin, pulse, blood, lab, meds, train, profile
   - `log_dose` — "Log that the user just took one dose of a medicine in their list" — parameter `drug_key` (string, required): the key shown in user_context
   - `show_emergency` — "Show the emergency call banner" — no parameters
7. **Dynamic variables**: `user_name` and `user_context` are sent by the app (placeholders can be any text).
8. **Security → Allowed hosts**: add your Netlify domain.
9. Copy the **Agent ID**, then put it in `public/firebase-config.js`: `window.HT_ELEVENLABS_AGENT_ID = "agent_...";`
