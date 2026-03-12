from fastapi import FastAPI, BackgroundTasks
from salic_bot import SalicBot
from supabase import create_client
from decouple import config
import uvicorn

app = FastAPI()

# Configuração Supabase
url = config('SUPABASE_URL')
key = config('SUPABASE_KEY')
supabase = create_client(url, key)

def process_rpa_task(document_id: str):
    # 1. Buscar dados do documento no Supabase
    res = supabase.from_('documents').select('*, projects(pronac)').eq('id', document_id).single().execute()
    doc = res.data
    
    if not doc:
        print(f"Documento {document_id} não encontrado.")
        return

    # 2. Buscar credenciais do usuário
    user_id = doc['user_id']
    cred_res = supabase.from_('external_credentials').select('*').eq('user_id', user_id).eq('service_name', 'salic').maybe_single().execute()
    creds = cred_res.data

    if not creds:
        print(f"Credenciais SALIC não encontradas para o usuário {user_id}")
        supabase.from_('documents').update({
            'status': 'erro_rpa',
            'justification': "Erro: Credenciais SALIC não configuradas. Acesse Configurações."
        }).eq('id', document_id).execute()
        return

    # 3. Executar Bot com as credenciais do banco
    bot = SalicBot(username=creds['identifier'], password=creds['secret'])
    success, message = bot.run_automation(doc)

    # 3. Atualizar Status no Supabase
    new_status = 'enviado_salic' if success else 'erro_rpa'
    supabase.from_('documents').update({
        'status': new_status,
        'protocolo_salic': 'PROT-' + document_id[:8].upper() if success else None,
        'justification': f"RPA: {message}" if not success else doc['justification']
    }).eq('id', document_id).execute()

@app.post("/run-rpa/{document_id}")
async def trigger_rpa(document_id: str, background_tasks: BackgroundTasks):
    # n8n chama este endpoint
    background_tasks.add_task(process_rpa_task, document_id)
    return {"message": "RPA iniciado em segundo plano", "document_id": document_id}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
