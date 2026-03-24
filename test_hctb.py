import inspect

try:
    import pyhctb
    print(f"pyhctb version: {getattr(pyhctb, '__version__', 'unknown')}")
    
    # Try to find the client class
    module_classes = inspect.getmembers(pyhctb, inspect.isclass)
    print(f"Classes found: {[name for name, _ in module_classes]}")
    
    if hasattr(pyhctb, 'HctbClient'):
        client_cls = pyhctb.HctbClient
    elif hasattr(pyhctb, 'Client'):
        client_cls = pyhctb.Client
    else:
        client_cls = None
        
    if client_cls:
        print(f"--- Methods in {client_cls.__name__} ---")
        for name, member in inspect.getmembers(client_cls, inspect.isroutine):
            if not name.startswith('_'):
                try:
                    sig = inspect.signature(member)
                    print(f"{name}{sig}")
                except ValueError:
                    print(f"{name}() -> built-in method")
    else:
        print("Could not find main client class. Contents of pyhctb:")
        print(dir(pyhctb))

except Exception as e:
    print(f"Error inspecting pyhctb: {e}")
