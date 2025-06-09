import pandas as pd
from google.cloud import firestore
import os

def fetch_from_firestore(project_id: str, collection_name: str, limit: int = None) -> pd.DataFrame:
    """
    Fetches data from a specified Firestore collection and returns it as a Pandas DataFrame.

    Args:
        project_id (str): The GCP project ID.
        collection_name (str): The name of the Firestore collection to fetch from
                               (e.g., "v10_trade_attempts").
        limit (int, optional): Maximum number of documents to fetch. Defaults to None (all).

    Returns:
        pd.DataFrame: A DataFrame containing the fetched data.
                      Returns an empty DataFrame if an error occurs or no data is found.
    """
    print(f"Attempting to fetch data from Firestore collection '{collection_name}' in project '{project_id}'...")

    try:
        # Check if FIRESTORE_EMULATOR_HOST is set for local development
        emulator_host = os.getenv("FIRESTORE_EMULATOR_HOST")
        db = None
        if emulator_host:
            print(f"Connecting to Firestore Emulator at: {emulator_host}")
            # For emulator, project_id might not be strictly enforced by client,
            # but good to pass for consistency.
            # Credentials are not needed for the emulator.
            db = firestore.Client(project=project_id)
            # The above line implicitly uses FIRESTORE_EMULATOR_HOST if set.
            # For older library versions, you might need:
            # from google.auth.credentials import AnonymousCredentials
            # db = firestore.Client(project=project_id, credentials=AnonymousCredentials())
        else:
            print("Connecting to live Firestore.")
            # Assumes ADC or service account credentials are set up in the environment
            db = firestore.Client(project=project_id)

        docs_query = db.collection(collection_name)

        if limit:
            print(f"Applying limit: {limit} documents.")
            docs_query = docs_query.limit(limit)

        docs = docs_query.stream()
        data_list = []
        for doc in docs:
            doc_data = doc.to_dict()
            # Ensure espInputFeatures is a dict, handle if it's missing or not a dict
            if 'espInputFeatures' not in doc_data or not isinstance(doc_data['espInputFeatures'], dict):
                doc_data['espInputFeatures'] = {} # Default to empty dict if missing/wrong type
            data_list.append(doc_data)


        if not data_list:
            print("No documents found in the collection.")
            return pd.DataFrame()

        # Normalize nested fields (like 'executionDetails' or 'espInputFeatures')
        # The 'espInputFeatures' field is expected to be a map/dict in Firestore.
        # Other nested fields might also exist, e.g., 'executionDetails.actualNetProfitLossUsd'
        # pandas json_normalize can help flatten these structures.
        df = pd.json_normalize(data_list, sep='.')
        print(f"Successfully fetched and normalized {len(df)} documents into a DataFrame.")
        return df

    except Exception as e:
        print(f"Error fetching data from Firestore: {e}")
        # For critical errors like auth, it might raise google.auth.exceptions.DefaultCredentialsError
        # or grpc._channel._InactiveRpcError if emulator not running but host is set.
        return pd.DataFrame()

if __name__ == '__main__':
    # Example usage (for testing this module directly)
    # Ensure FIRESTORE_EMULATOR_HOST is set if using emulator,
    # e.g., export FIRESTORE_EMULATOR_HOST="localhost:8080"
    # Ensure GCP_PROJECT_ID is set.
    # You'd need some data in your emulator's 'v10_trade_attempts' collection.

    gcp_project = os.getenv("GCP_PROJECT_ID")
    if not gcp_project:
        print("GCP_PROJECT_ID environment variable not set. Exiting example.")
    else:
        print(f"Running example with GCP_PROJECT_ID: {gcp_project}")
        example_collection = "v10_trade_attempts" # Make sure this matches your Firestore data

        # Create dummy data in emulator if it's empty for a quick test
        # This part is for CLI testing of the script, not for the main pipeline
        emulator_host_for_test = os.getenv("FIRESTORE_EMULATOR_HOST")
        if emulator_host_for_test:
            try:
                client = firestore.Client(project=gcp_project)
                # Check if collection is empty
                current_docs = list(client.collection(example_collection).limit(1).stream())
                if not current_docs:
                     print(f"Populating dummy data in '{example_collection}' for testing...")
                     dummy_data = [
                        {
                            "opportunityId": "opp1", "attemptTimestamp": firestore.SERVER_TIMESTAMP,
                            "espInputFeatures": {"feature1": 0.5, "feature2": 100, "marketVolatility": 0.03, "gasPrice": 50.0},
                            "executionDetails": {"executionStatus": "SUCCESS_ON_CHAIN", "actualNetProfitLossUsd": 10.5}
                        },
                        {
                            "opportunityId": "opp2", "attemptTimestamp": firestore.SERVER_TIMESTAMP,
                            "espInputFeatures": {"feature1": 0.2, "feature2": 120, "marketVolatility": 0.05, "gasPrice": 60.0},
                            "executionDetails": {"executionStatus": "REVERTED", "actualNetProfitLossUsd": -2.1}
                        },
                        {
                            "opportunityId": "opp3", "attemptTimestamp": firestore.SERVER_TIMESTAMP,
                            "espInputFeatures": {"feature1": 0.9, "feature3": 50, "marketVolatility": 0.02, "gasPrice": 55.0}, # Missing feature2
                            "executionDetails": {"executionStatus": "SUCCESS_ON_CHAIN", "actualNetProfitLossUsd": 22.0}
                        },
                        { # Data point without espInputFeatures
                            "opportunityId": "opp4", "attemptTimestamp": firestore.SERVER_TIMESTAMP,
                            "executionDetails": {"executionStatus": "SUCCESS_ON_CHAIN", "actualNetProfitLossUsd": 5.0}
                        }
                    ]
                     for item in dummy_data:
                        client.collection(example_collection).add(item)
                     print("Dummy data populated.")
                else:
                    print(f"Collection '{example_collection}' already has data. Skipping dummy data population.")
            except Exception as e:
                print(f"Could not populate dummy data (this is fine if emulator not running/configured for this test script): {e}")


        df_data = fetch_from_firestore(
            project_id=gcp_project,
            collection_name=example_collection,
            limit=100
        )

        if not df_data.empty:
            print("\nFetched DataFrame head:")
            print(df_data.head())
            print("\nDataFrame Info:")
            df_data.info()
            print("\nMissing values per column:")
            print(df_data.isnull().sum())
        else:
            print("\nNo data returned from fetch_from_firestore.")
