# Air Master Agent (n8n)

n8n workflow for the Air Master cargo intake agent. OpenAI-backed. Greets the user
and collects shipment **L/W/H (cm), Weight (kg), Quantity**, then confirms.

## Nodes
- **Chat Trigger** — hosted chat UI. Sends the welcome message:
  *"Hi, this is Air Master Agent. Could you send me your shipment L/W/H, weight and quantity?"*
- **Air Master Agent** — LangChain AI Agent. System prompt drives the intake + confirm flow.
- **OpenAI Chat Model** — `gpt-4o-mini`, temperature 0.3.
- **Window Buffer Memory** — keeps the last 20 turns so multi-item manifests stay in context.

## Import
1. n8n → **Workflows → Import from File** → select `air-master-agent.json`.
2. Open **OpenAI Chat Model** node → set credential to your OpenAI account
   (replaces the `REPLACE_WITH_OPENAI_CRED_ID` placeholder).
3. **Save**, then toggle **Active** (or click **Open chat** to test).

## Notes
- Dimensions are always cm, weight always kg. The prompt asks the user to confirm
  if a value looks like another unit (mm/m).
- This version only collects & confirms. To forward boxes to the platform engine,
  add an HTTP Request node calling `POST /api/loadplan` after the agent.
