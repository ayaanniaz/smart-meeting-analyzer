from groq import Groq
from sentence_transformers import SentenceTransformer
from config import GROQ_API_KEY
import os

# Initialize Groq Client
if GROQ_API_KEY:
    groq_client = Groq(api_key=GROQ_API_KEY)
else:
    print("Warning: GROQ_API_KEY not set. AI features will fail.")
    groq_client = None

# Initialize Sentence Transformer (Local Embedding Model)
# all-MiniLM-L6-v2 produces 384 dimensional vectors
print("Loading Embedding Model (all-MiniLM-L6-v2)...")
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
print("Embedding Model Loaded.")

def generate_embedding(text: str):
    """
    Generates embedding for the given text using local SentenceTransformer.
    Returns a list of floats (dimension 384).
    """
    try:
        # encode returns numpy array, convert to list
        return embedding_model.encode(text).tolist()
    except Exception as e:
        print(f"Error generating embedding: {e}")
        raise e

def generate_answer(query: str, context: str):
    """
    Generates an answer using Groq (Llama 3 8b or similar) based on the context.
    """
    if not groq_client:
        return "Error: Groq API Key not configured."

    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile", # Updated model
            messages=[
                {
                    "role": "system",
                    "content": "You are an intelligent assistant analyzing a meeting transcript. Answer directly based on the provided context."
                },
                {
                    "role": "user",
                    "content": f"Question: {query}\n\nContext:\n{context}"
                }
            ],
            temperature=0.5,
            max_tokens=1024,
            top_p=1,
            stream=False,
            stop=None,
        )
        return completion.choices[0].message.content
    except Exception as e:
        print(f"Error generating answer: {e}")
        return f"Error dealing with Groq API: {str(e)}"
