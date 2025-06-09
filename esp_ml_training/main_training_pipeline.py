import argparse
import json
import os
import pandas as pd
from datetime import datetime
import joblib # Added for saving scaler and non-NN models

from data_ingestion import firestore_ingestor # Actual import
# from feature_engineering import feature_generator # Still placeholder
# from preprocessing import data_preprocessor # Still placeholder
# from model_training import train # Still placeholder
# from evaluation import evaluator # Still placeholder

from data_ingestion import firestore_ingestor
from feature_engineering import feature_generator
from preprocessing import data_preprocessor
from model_training.train import ModelTrainer # Actual import
# from evaluation import evaluator # Still placeholder

from data_ingestion import firestore_ingestor
from feature_engineering import feature_generator
from preprocessing import data_preprocessor
from model_training.train import ModelTrainer
from evaluation import evaluator # Actual import

# All module placeholders are now removed as actual modules are created or will be.
# If any were missed, they'd be caught here by Python interpreter.
# For this task, all specified modules up to 'evaluation' are done.


# Ensure 'trained_models' directory exists
MODEL_OUTPUT_DIR = "trained_models"
os.makedirs(MODEL_OUTPUT_DIR, exist_ok=True)

def run_pipeline(config_path: str):
    """
    Main function to run the ESP ML model training pipeline.
    """
    print(f"Starting ML training pipeline with config path (unused for now): {config_path}...")

    config = {
        "gcp_project_id": os.getenv("GCP_PROJECT_ID", "your-gcp-project-id"),
        "firestore_collection_train": "v10_trade_attempts",
        "max_documents_to_fetch": 10000,
        "test_set_size_ratio": 0.2,
        "validation_set_size_ratio": 0.2, # Added as per instructions
        "model_type": "neural_network",
        "esp_model_version": "v1.0.0",
        "target_variable_execution": "isSuccess_Execution",
        "target_variable_profitability": "isSuccess_Profitability",
        "min_acceptable_profit_post_execution_usd": 1.0,
        "feature_list_version": "v1_0_SSOT_6_3_2",
        "random_state": 42,
        "neural_network_params": {
            # input_dim will be set dynamically in ModelTrainer based on X_train.shape[1]
            "epochs": 50,
            "batch_size": 32,
            "learning_rate": 0.001,
            "early_stopping_patience": 5, # For Keras EarlyStopping
            "keras_verbose": 1 # 0=silent, 1=progress bar, 2=one line per epoch
        },
        "xgboost_params": {
            "n_estimators": 100,
            "learning_rate": 0.05,
            "max_depth": 5,
            # "use_label_encoder": False, # Handled by default in ModelTrainer
            "eval_metric": "logloss",
            "early_stopping_rounds": 10,
            "xgb_verbose": False
        },
        "lightgbm_params": {
            "n_estimators": 100,
            "learning_rate": 0.05,
            "num_leaves": 31,
            "metric": 'binary_logloss', # eval_metric for LGBM fit
            "early_stopping_rounds": 10, # for callback
            "lgbm_verbose_eval": -1 # LightGBM callback verbosity
        },
        "output_model_name_base": "esp_model",
        "scaler_type": "standard" # Added for scaler selection
    }
    print(f"Using hardcoded configuration: {json.dumps(config, indent=2)}")

    print("\n--- Stage 1: Data Ingestion ---")
    raw_df = firestore_ingestor.fetch_from_firestore(
        project_id=config["gcp_project_id"],
        collection_name=config["firestore_collection_train"],
        limit=config.get("max_documents_to_fetch")
    )
    if raw_df.empty:
        print("No data fetched (mock response was empty). Exiting.")
        return
    print(f"Fetched {len(raw_df)} records (mock).")
    print(f"Raw data columns (mock): {raw_df.columns.tolist()}")

    print("\n--- Stage 2: Labeling ---")
    if 'executionDetails.executionStatus' in raw_df.columns:
         raw_df[config["target_variable_execution"]] = raw_df['executionDetails.executionStatus'].apply(
            lambda x: 1 if x == "SUCCESS_ON_CHAIN" else 0
        )
    else:
        print(f"Warning: Column 'executionDetails.executionStatus' not found. Creating dummy target '{config['target_variable_execution']}'.")
        raw_df[config["target_variable_execution"]] = 0

    if 'executionDetails.actualNetProfitLossUsd' in raw_df.columns:
        raw_df[config["target_variable_profitability"]] = raw_df['executionDetails.actualNetProfitLossUsd'].apply(
            lambda x: 1 if pd.notna(x) and x > config["min_acceptable_profit_post_execution_usd"] else 0
        )
    else:
         print(f"Warning: Column 'executionDetails.actualNetProfitLossUsd' not found. Creating dummy target '{config['target_variable_profitability']}'.")
         raw_df[config["target_variable_profitability"]] = 0

    print(f"Target variable '{config['target_variable_execution']}' distribution (mock):\n{raw_df[config['target_variable_execution']].value_counts(normalize=True, dropna=False)}")
    print(f"Target variable '{config['target_variable_profitability']}' distribution (mock):\n{raw_df[config['target_variable_profitability']].value_counts(normalize=True, dropna=False)}")

    print("\n--- Stage 3: Feature Engineering ---")
    features_df = feature_generator.generate_features(
        raw_df,
        feature_list_version=config["feature_list_version"]
    )
    print(f"Engineered features (mock). Shape: {features_df.shape}")
    print(f"Engineered features columns (mock): {features_df.columns.tolist()}")

    y_target_series = features_df[config["target_variable_execution"]]
    X_features_df = features_df.drop(columns=[
        config["target_variable_execution"],
        config["target_variable_profitability"]
    ], errors='ignore')

    print("\n--- Stage 4: Data Preprocessing ---")
    # Split data into training, validation, and test sets
    X_train_val, X_temp_test, y_train_val, y_temp_test = data_preprocessor.split_data(
        X_features_df, y_target_series,
        test_size=config["test_set_size_ratio"],
        random_state=config["random_state"],
        stratify=y_target_series # Stratify by target variable
    )
    # Split train_val into final training and validation sets
    # validation_set_size_ratio is proportion of the original train_val set (1-test_size of total)
    # effective_val_size = config["validation_set_size_ratio"] / (1-config["test_set_size_ratio"]) # if val_size was for total
    # Since validation_size is defined as fraction of train_val set:
    X_train, X_val, y_train, y_val = data_preprocessor.split_data(
        X_train_val, y_train_val,
        test_size=config["validation_set_size_ratio"], # This is now fraction of X_train_val
        random_state=config["random_state"],
        stratify=y_train_val # Stratify validation split as well
    )
    X_test = X_temp_test # Assign the held-out test set
    y_test = y_temp_test

    print(f"Data split complete: Train {X_train.shape}, Validation {X_val.shape}, Test {X_test.shape}")

    # Scale features
    X_train_scaled, X_test_scaled, X_val_scaled, scaler = data_preprocessor.scale_features(
        X_train, X_test, X_val, scaler_type=config.get("scaler_type", "standard") # Allow scaler_type from config
    )
    print(f"Feature scaling complete. X_train_scaled: {X_train_scaled.shape}, X_val_scaled: {X_val_scaled.shape if X_val_scaled is not None else 'N/A'}, X_test_scaled: {X_test_scaled.shape if X_test_scaled is not None else 'N/A'}")

    print("\n--- Stage 5: Model Training ---")
    # Instantiate the actual ModelTrainer
    model_trainer_instance = ModelTrainer( # Changed from train.ModelTrainer
        model_type=config["model_type"],
        model_params=config.get(f"{config['model_type']}_params", {}), # Get specific params like nn_params, xgb_params
        random_state=config["random_state"]
    )

    # Train the model (ModelTrainer's train method handles X_val, y_val internally)
    history = model_trainer_instance.train(X_train_scaled, y_train, X_val_scaled, y_val)
    print("Model training completed.")

    print("\n--- Stage 6: Model Evaluation ---")
    trained_model_instance = model_trainer_instance.get_model()
    if trained_model_instance is not None:
        evaluation_results = evaluator.evaluate_model(
            trained_model_instance,
            X_test_scaled,
            y_test,
            model_type=config["model_type"] # Pass model_type for correct prediction handling
        )
        print(f"Evaluation results: {evaluation_results}")
    else:
        print("Error: Trained model is None. Skipping evaluation.")
        evaluation_results = {"error": "Model training failed or model not returned."}


    print("\n--- Stage 7: Model Serialization ---")
    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_name = f"{config['output_model_name_base']}_{config['model_type']}_{config['esp_model_version']}_{timestamp_str}"

    tfjs_model_path = None
    native_model_path = None # For non-NN models

    if config["model_type"] == "neural_network":
        tfjs_model_path = os.path.join(MODEL_OUTPUT_DIR, model_name + "_tfjs")
        model_trainer_instance.save_for_tfjs(tfjs_model_path) # Use the method from ModelTrainer instance
        # print(f"Neural network model saved in TensorFlow.js format to: {tfjs_model_path}") # Already printed by save_for_tfjs
    else:
        # For XGBoost, LightGBM, etc.
        native_model_path = os.path.join(MODEL_OUTPUT_DIR, model_name + ".joblib")
        if trained_model_instance is not None: # Ensure model exists
            joblib.dump(trained_model_instance, native_model_path)
            print(f"Model saved in native format to: {native_model_path}")
        else:
            print("Warning: Trained model instance is None. Cannot save native model.")

    scaler_path = os.path.join(MODEL_OUTPUT_DIR, model_name + "_scaler.joblib")
    joblib.dump(scaler, scaler_path) # Save the mock scaler string
    print(f"Scaler saved to (mock): {scaler_path}")

    metadata = {
        "model_name": model_name,
        "model_type": config["model_type"],
        "esp_model_version": config["esp_model_version"],
        "feature_list_version": config["feature_list_version"],
        "training_timestamp": datetime.now().isoformat(),
        "evaluation_results": evaluation_results,
        "scaler_path": scaler_path, # Path to the joblib scaler file
        "tfjs_model_path": tfjs_model_path,
        "native_model_path": native_model_path,
        "feature_columns_ordered": X_features_df.columns.tolist() if hasattr(X_features_df, 'columns') else []
    }

    # Add scaler parameters to metadata for JS/TS implementation
    if scaler is not None: # Scaler object from data_preprocessor.scale_features
        numeric_cols_scaled = [col for col in X_features_df.columns if pd.api.types.is_numeric_dtype(X_features_df[col])] # Re-identify numeric columns from X_features_df

        if hasattr(scaler, 'mean_') and scaler.mean_ is not None: # StandardScaler
            metadata["scaler_type"] = "standard"
            metadata["scaler_params"] = {
                "mean": dict(zip(numeric_cols_scaled, scaler.mean_)),
                "scale": dict(zip(numeric_cols_scaled, scaler.scale_)) # scale_ is std_dev for StandardScaler
            }
            metadata["numeric_features_scaled"] = numeric_cols_scaled
            print(f"Saved StandardScaler params for {len(numeric_cols_scaled)} numeric features.")
        elif hasattr(scaler, 'data_min_') and scaler.data_min_ is not None: # MinMaxScaler
            metadata["scaler_type"] = "minmax"
            metadata["scaler_params"] = {
                "min": dict(zip(numeric_cols_scaled, scaler.data_min_)),
                "max": dict(zip(numeric_cols_scaled, scaler.data_max_)) # Or use scaler.scale_ and min_ to derive max if needed
            }
            metadata["numeric_features_scaled"] = numeric_cols_scaled
            print(f"Saved MinMaxScaler params for {len(numeric_cols_scaled)} numeric features.")
        else:
            print("Warning: Scaler type not recognized or scaler not fitted properly. Scaler params not saved in metadata.")
    else:
        print("Warning: Scaler object is None. Scaler params not saved in metadata.")


    metadata_path = os.path.join(MODEL_OUTPUT_DIR, model_name + "_metadata.json")
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=4)
    print(f"Metadata saved to: {metadata_path}")

    print("\n--- ML Training Pipeline Finished (mock execution) ---")

if __name__ == "__main__":
    # For this subtask, direct call with dummy config path is fine.
    # Actual config loading from file can be implemented with the modules.
    run_pipeline("dummy_config_path_for_now")
```
