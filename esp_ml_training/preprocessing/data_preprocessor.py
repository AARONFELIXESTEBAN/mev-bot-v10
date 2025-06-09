import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from typing import Tuple, Optional, Union, List
import numpy as np # For handling potential all-NaN slices if not careful

def split_data(
    X: pd.DataFrame,
    y: pd.Series,
    test_size: float = 0.2,
    validation_size: Optional[float] = None, # Proportion of training set for validation
    random_state: Optional[int] = None,
    stratify: Optional[pd.Series] = None
) -> Union[Tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series],
           Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, pd.Series]]:
    """
    Splits features (X) and target (y) into training and testing sets.
    Optionally, can also create a validation set from the training set.

    Args:
        X (pd.DataFrame): DataFrame of features.
        y (pd.Series): Series of target variable.
        test_size (float): Proportion of the dataset to include in the test split.
        validation_size (float, optional): Proportion of the *training* set to use for validation.
                                           If None, only train/test split is performed.
        random_state (int, optional): Seed for random number generator for reproducibility.
        stratify (pd.Series, optional): If not None, data is split in a stratified fashion,
                                        using this as the class labels.

    Returns:
        Tuple: Depending on validation_size:
               (X_train, X_test, y_train, y_test) or
               (X_train, X_val, X_test, y_train, y_val, y_test)
    """
    print(f"Splitting data. Test size: {test_size}, Validation size (from train_val set): {validation_size}")

    # Ensure X and y have consistent indices if they are already aligned
    # This helps prevent errors if X and y were manipulated separately before this call
    if not X.index.equals(y.index):
         print("Warning: X and y indices do not match. Resetting indices for split.")
         X = X.reset_index(drop=True)
         y = y.reset_index(drop=True)

    # Stratify requires the stratify array to be aligned with X and y
    stratify_array = None
    if stratify is not None:
        if not stratify.index.equals(y.index): # Check alignment with y (which is now aligned with X)
            print("Warning: Stratify series index does not match y index. Resetting stratify index.")
            stratify_array = stratify.reset_index(drop=True)
        else:
            stratify_array = stratify

    X_train_val, X_test, y_train_val, y_test = train_test_split(
        X, y,
        test_size=test_size,
        random_state=random_state,
        stratify=stratify_array
    )

    if validation_size is not None and validation_size > 0:
        # Stratify for validation split as well if original was stratified
        stratify_val_array = y_train_val if stratify_array is not None else None

        # Adjust validation_size to be a fraction of the X_train_val set
        # Example: if original had 100, test_size=0.2 -> X_train_val=80.
        # If validation_size=0.25 (meaning 25% of X_train_val for validation), then val_set size is 80*0.25=20.
        X_train, X_val, y_train, y_val = train_test_split(
            X_train_val, y_train_val,
            test_size=validation_size,
            random_state=random_state,
            stratify=stratify_val_array
        )
        print(f"Train shape: {X_train.shape}, Val shape: {X_val.shape}, Test shape: {X_test.shape}")
        return X_train, X_val, X_test, y_train, y_val, y_test
    else:
        print(f"Train shape: {X_train_val.shape}, Test shape: {X_test.shape}")
        return X_train_val, X_test, y_train_val, y_test


def scale_features(
    X_train: pd.DataFrame,
    X_test: Optional[pd.DataFrame] = None,
    X_val: Optional[pd.DataFrame] = None,
    scaler_type: str = "standard", # "standard" or "minmax"
    existing_scaler: Optional[Union[StandardScaler, MinMaxScaler]] = None
) -> Tuple[pd.DataFrame, Optional[pd.DataFrame], Optional[pd.DataFrame], Optional[Union[StandardScaler, MinMaxScaler]]]:
    """
    Scales features using StandardScaler or MinMaxScaler.
    The scaler is fitted on the training data and then used to transform
    training, testing, and optional validation sets. Only numeric features are scaled.

    Args:
        X_train (pd.DataFrame): Training features.
        X_test (pd.DataFrame, optional): Testing features.
        X_val (pd.DataFrame, optional): Validation features.
        scaler_type (str): Type of scaler to use ("standard" or "minmax").
        existing_scaler (Union[StandardScaler, MinMaxScaler], optional):
                           An already fitted scaler to use for transforming data.

    Returns:
        Tuple: (X_train_scaled, X_test_scaled, X_val_scaled, scaler_instance)
               X_test_scaled and X_val_scaled will be None if input was None.
               Scaler_instance will be None if no numeric columns are found.
    """
    print(f"Scaling features using {scaler_type} scaler.")
    numeric_cols = X_train.select_dtypes(include=np.number).columns.tolist()

    if not numeric_cols:
        print("Warning: No numeric columns found to scale in X_train.")
        return X_train, X_test, X_val, None

    X_train_scaled_df = X_train.copy()
    X_test_scaled_df = X_test.copy() if X_test is not None else None
    X_val_scaled_df = X_val.copy() if X_val is not None else None

    scaler: Union[StandardScaler, MinMaxScaler]

    if existing_scaler:
        scaler = existing_scaler
        print("Using existing scaler.")
    else:
        if scaler_type == "standard":
            scaler = StandardScaler()
        elif scaler_type == "minmax":
            scaler = MinMaxScaler()
        else:
            raise ValueError("scaler_type must be 'standard' or 'minmax'")

        train_numeric_data = X_train[numeric_cols].astype(np.float64)
        # Fill NaN values before fitting the scaler to avoid errors with some scalers/versions
        # Using median for filling as it's robust to outliers.
        # This should ideally be done based on analysis, or handle columns that are all NaN.
        for col in train_numeric_data.columns:
            if train_numeric_data[col].isnull().all():
                 print(f"Warning: Column '{col}' in X_train is all NaN. Filling with 0 before scaling fit.")
                 train_numeric_data[col] = 0.0
            elif train_numeric_data[col].isnull().any():
                 median_val = train_numeric_data[col].median()
                 print(f"Warning: Column '{col}' in X_train has NaN values. Filling with median ({median_val}) before scaling fit.")
                 train_numeric_data[col] = train_numeric_data[col].fillna(median_val)

        scaler.fit(train_numeric_data)
        print("Scaler fitted on training data's numeric columns.")

    # Transform numeric columns, ensure NaNs are handled before transform (e.g., fill with 0 or mean/median of train)
    # For simplicity and consistency with fit, we'll fill with 0 if NaNs exist post-split.
    # A more robust pipeline might impute these NaNs based on training set statistics.
    X_train_scaled_df[numeric_cols] = scaler.transform(X_train[numeric_cols].astype(np.float64).fillna(0))

    if X_test is not None and X_test_scaled_df is not None:
        X_test_scaled_df[numeric_cols] = scaler.transform(X_test[numeric_cols].astype(np.float64).fillna(0))

    if X_val is not None and X_val_scaled_df is not None:
        X_val_scaled_df[numeric_cols] = scaler.transform(X_val[numeric_cols].astype(np.float64).fillna(0))

    return X_train_scaled_df, X_test_scaled_df, X_val_scaled_df, scaler


if __name__ == '__main__':
    # Example Usage
    data = {
        'feature1': np.random.rand(100),
        'feature2': np.random.rand(100) * 10,
        'feature3': np.random.choice(['A', 'B', 'C'], 100),
        'feature_all_nan_train': [np.nan]*50 + list(np.random.rand(50)), # Test column that might be all NaN in a split
        'target': np.random.randint(0, 2, 100)
    }
    sample_df = pd.DataFrame(data)
    X_sample = sample_df[['feature1', 'feature2', 'feature3', 'feature_all_nan_train']]
    y_sample = sample_df['target']

    print("Original X sample:")
    print(X_sample.head())
    print(f"NaNs in feature_all_nan_train: {X_sample['feature_all_nan_train'].isnull().sum()}")


    # Test split_data without validation set
    X_train_s, X_test_s, y_train_s, y_test_s = split_data(
        X_sample, y_sample, test_size=0.25, random_state=42, stratify=y_sample
    )
    print(f"\nSplit shapes (no val): Train {X_train_s.shape}, Test {X_test_s.shape}")
    print(f"NaNs in X_train_s.feature_all_nan_train: {X_train_s['feature_all_nan_train'].isnull().sum()}")


    # Test split_data with validation set
    X_train_v, X_val_v, X_test_v, y_train_v, y_val_v, y_test_v = split_data(
        X_sample, y_sample, test_size=0.2, validation_size=0.25, random_state=42, stratify=y_sample
    )
    print(f"Split shapes (with val): Train {X_train_v.shape}, Val {X_val_v.shape}, Test {X_test_v.shape}")
    print(f"NaNs in X_train_v.feature_all_nan_train: {X_train_v['feature_all_nan_train'].isnull().sum()}")


    # Test scale_features
    X_train_scaled, X_test_scaled, X_val_scaled, fitted_scaler = scale_features(
        X_train_v, X_test_v, X_val_v, scaler_type="standard"
    )
    print("\nScaled X_train head (StandardScaler):")
    print(X_train_scaled.head())
    if X_test_scaled is not None:
        print("Scaled X_test head (StandardScaler):")
        print(X_test_scaled.head())
    if X_val_scaled is not None:
        print("Scaled X_val head (StandardScaler):")
        print(X_val_scaled.head())
    print(f"Scaler instance: {fitted_scaler}")

    # Example of using an existing scaler on new data
    new_data_sample = X_sample.sample(5, random_state=1).copy()
    # Simulate that new_data_sample is like X_train for the purpose of scaling
    # It will be scaled as if it's the "test" set when using an existing scaler
    _, new_data_scaled, _, _ = scale_features(
        new_data_sample, # Pass as X_train to indicate its structure
        new_data_sample, # Pass as X_test to get it scaled
        None,            # No X_val for this example
        existing_scaler=fitted_scaler
    )
    print("\nNew data sample (scaled with existing StandardScaler):")
    if new_data_scaled is not None:
        print(new_data_scaled.head())
```
