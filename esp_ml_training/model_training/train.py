import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
import xgboost as xgb
import lightgbm as lgb
import joblib # For saving TF.js model using a different approach if needed
import os
import pandas as pd # For type hinting
import numpy as np # For X_val.to_numpy()
from typing import Optional, Dict, Any, Union

class ModelTrainer:
    """
    A class to handle training of different model types.
    Currently supports: 'neural_network', 'xgboost', 'lightgbm'.
    """
    def __init__(self, model_type: str = "neural_network", model_params: Optional[Dict[str, Any]] = None, random_state: Optional[int] = None):
        self.model_type = model_type
        self.model_params = model_params if model_params else {}
        self.random_state = random_state
        self.model: Optional[Union[keras.Model, xgb.XGBClassifier, lgb.LGBMClassifier]] = None
        self.history = None # For Keras training history

        print(f"ModelTrainer initialized for model_type: {self.model_type} with params: {self.model_params}")

        # Model building is deferred until input_dim is known for NN, or handled by library for others.
        if self.model_type == "neural_network":
            # Initial build if input_dim is already in params, otherwise will be built in train()
            if self.model_params.get("input_dim"):
                self._build_neural_network()
            else:
                print("Neural network input_dim not provided at init. Will build model when train() is called with data.")
        elif self.model_type == "xgboost":
            # Ensure use_label_encoder is False by default if not provided, to avoid warnings with newer XGBoost versions
            if 'use_label_encoder' not in self.model_params:
                self.model_params['use_label_encoder'] = False
            self.model = xgb.XGBClassifier(random_state=self.random_state, **self.model_params)
        elif self.model_type == "lightgbm":
            self.model = lgb.LGBMClassifier(random_state=self.random_state, **self.model_params)
        else:
            raise ValueError(f"Unsupported model_type: {self.model_type}. Supported types: neural_network, xgboost, lightgbm")

    def _build_neural_network(self):
        """Builds a simple Feedforward Neural Network using Keras."""
        input_dim = self.model_params.get("input_dim", None)
        if input_dim is None:
            raise ValueError("input_dim must be provided in model_params for neural_network before building.")

        hidden_units_1 = self.model_params.get("hidden_units_1", 64)
        hidden_units_2 = self.model_params.get("hidden_units_2", 32)
        dropout_rate = self.model_params.get("dropout_rate", 0.3)
        learning_rate = self.model_params.get("learning_rate", 0.001)

        inputs = keras.Input(shape=(input_dim,), name="input_features")
        x = layers.Dense(hidden_units_1, activation="relu")(inputs)
        x = layers.Dropout(dropout_rate)(x)
        x = layers.Dense(hidden_units_2, activation="relu")(x)
        x = layers.Dropout(dropout_rate)(x)
        outputs = layers.Dense(1, activation="sigmoid", name="output_sigmoid")(x)

        self.model = keras.Model(inputs=inputs, outputs=outputs)

        self.model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=learning_rate),
            loss="binary_crossentropy",
            metrics=["accuracy", tf.keras.metrics.AUC(name='auc')]
        )
        print(f"Neural network model built and compiled with input_dim: {input_dim}.")

    def train(self, X_train: pd.DataFrame, y_train: pd.Series,
              X_val: Optional[pd.DataFrame] = None, y_val: Optional[pd.Series] = None):
        """
        Trains the initialized model.
        """
        if self.model_type == "neural_network":
            if not isinstance(self.model, keras.Model) or self.model.input_shape[-1] is None:
                # If model wasn't built or input_dim wasn't known
                print(f"Neural network input dimension set to: {X_train.shape[1]}")
                self.model_params["input_dim"] = X_train.shape[1]
                self._build_neural_network()

            if not isinstance(self.model, keras.Model): # Type guard for mypy
                raise TypeError("Model is not a Keras model after build attempt.")

            epochs = self.model_params.get("epochs", 10)
            batch_size = self.model_params.get("batch_size", 32)
            callbacks = []
            validation_data_for_fit = None

            if X_val is not None and y_val is not None:
                early_stopping_patience = self.model_params.get("early_stopping_patience")
                if early_stopping_patience:
                    early_stopping = keras.callbacks.EarlyStopping(
                        monitor='val_loss', patience=early_stopping_patience, restore_best_weights=True
                    )
                    callbacks.append(early_stopping)
                validation_data_for_fit = (X_val, y_val)
                print(f"Training NN with validation data. Epochs: {epochs}, Batch Size: {batch_size}")
            else:
                print(f"Training NN without validation data. Epochs: {epochs}, Batch Size: {batch_size}")

            self.history = self.model.fit(
                X_train, y_train,
                epochs=epochs,
                batch_size=batch_size,
                validation_data=validation_data_for_fit,
                callbacks=callbacks,
                verbose=self.model_params.get("keras_verbose", 1)
            )

        elif self.model_type in ["xgboost", "lightgbm"]:
            if not hasattr(self.model, 'fit') or self.model is None: # self.model should be initialized in constructor
                raise TypeError(f"Model for {self.model_type} does not have a fit method or is not initialized.")

            fit_params: Dict[str, Any] = {}
            early_stopping_rounds_val = self.model_params.get("early_stopping_rounds")

            if X_val is not None and y_val is not None and early_stopping_rounds_val:
                if self.model_type == "xgboost" and isinstance(self.model, xgb.XGBClassifier):
                    fit_params['eval_set'] = [(X_val.to_numpy(), y_val.to_numpy())]
                    fit_params['early_stopping_rounds'] = early_stopping_rounds_val
                    fit_params['verbose'] = self.model_params.get("xgb_verbose", False) # xgb_verbose controls training verbosity
                elif self.model_type == "lightgbm" and isinstance(self.model, lgb.LGBMClassifier):
                    fit_params['eval_set'] = [(X_val, y_val)]
                    fit_params['eval_metric'] = self.model_params.get("metric", 'binary_logloss') # common metrics: 'logloss', 'auc', 'binary_logloss'
                    # LightGBM early stopping is handled via a callback
                    fit_params['callbacks'] = [
                        lgb.early_stopping(stopping_rounds=early_stopping_rounds_val, verbose=self.model_params.get("lgbm_verbose_eval", -1))
                    ]

            print(f"Training {self.model_type} with fit_params: {fit_params.keys()}") # Don't log values as they can be large dataframes
            self.model.fit(X_train, y_train, **fit_params)
        else:
            raise ValueError(f"Training logic for model type {self.model_type} not implemented.")

        print(f"{self.model_type} model training finished.")
        return self.history

    def get_model(self):
        return self.model

    def save_for_tfjs(self, model_path_tfjs: str):
        if self.model_type == "neural_network" and isinstance(self.model, keras.Model):
            try:
                import tensorflowjs as tfjs
                tfjs.converters.save_keras_model(self.model, model_path_tfjs)
                print(f"Keras model successfully converted and saved to TensorFlow.js format at {model_path_tfjs}")
            except ImportError:
                print("tensorflowjs pip package not found. Please install it to save in TF.js format.")
                print("You can typically install it with: pip install tensorflowjs")
            except Exception as e:
                print(f"Error saving Keras model to TensorFlow.js format: {e}")
        else:
            print(f"Model type {self.model_type} is not a Keras model. TF.js conversion via this method is not applicable.")
            print("For scikit-learn compatible models (XGBoost, LightGBM), consider ONNX conversion for TF.js if needed, or use a Python backend for inference.")

if __name__ == '__main__':
    # Example Usage
    num_samples = 200
    num_features = 10
    X_dummy_train = pd.DataFrame(np.random.rand(num_samples, num_features), columns=[f'feat_{i}' for i in range(num_features)])
    y_dummy_train = pd.Series(np.random.randint(0, 2, num_samples))
    X_dummy_val = pd.DataFrame(np.random.rand(num_samples//2, num_features), columns=[f'feat_{i}' for i in range(num_features)])
    y_dummy_val = pd.Series(np.random.randint(0, 2, num_samples//2))

    print("\n--- Testing Neural Network ---")
    nn_params = {
        "input_dim": num_features,
        "epochs": 3,
        "batch_size": 16,
        "learning_rate": 0.01,
        "early_stopping_patience": 2, # Keras EarlyStopping
        "keras_verbose": 1
    }
    nn_trainer = ModelTrainer(model_type="neural_network", model_params=nn_params)
    nn_trainer.train(X_dummy_train, y_dummy_train, X_dummy_val, y_dummy_val)
    if nn_trainer.get_model():
        print("NN Model trained.")
        os.makedirs("trained_models_test", exist_ok=True)
        nn_trainer.save_for_tfjs("trained_models_test/nn_model_tfjs")

    print("\n--- Testing XGBoost ---")
    xgb_params = {
        "n_estimators": 20,
        "learning_rate": 0.1,
        "max_depth": 3,
        "eval_metric": "logloss",
        "early_stopping_rounds": 5, # XGBoost fit param
        "xgb_verbose": False # XGBoost fit param for verbosity during training
    }
    # Note: use_label_encoder=False is handled by default in constructor now
    xgb_trainer = ModelTrainer(model_type="xgboost", model_params=xgb_params, random_state=42)
    xgb_trainer.train(X_dummy_train, y_dummy_train, X_dummy_val, y_dummy_val)
    if xgb_trainer.get_model():
        print("XGBoost Model trained.")

    print("\n--- Testing LightGBM ---")
    lgbm_params = {
        "n_estimators": 20,
        "learning_rate": 0.1,
        "num_leaves": 20,
        "metric": 'binary_logloss', # eval_metric for LGBM fit
        "early_stopping_rounds": 5, # used for callback
        "lgbm_verbose_eval": -1 # LightGBM callback verbosity (eval period)
    }
    lgbm_trainer = ModelTrainer(model_type="lightgbm", model_params=lgbm_params, random_state=42)
    lgbm_trainer.train(X_dummy_train, y_dummy_train, X_dummy_val, y_dummy_val)
    if lgbm_trainer.get_model():
        print("LightGBM Model trained.")
```
